// ================================================
// 自動化ルール — 「AIで投稿文を生成 → 下書き or（投稿前チェックを通過したら）自動投稿」を定期実行する
// ================================================
// AutomationRule の JSON 形式:
//   triggerConfig: { type: "daily", times: ["09:00","19:00"], timezone: "Asia/Tokyo" }
//                | { type: "interval", hours: 6 }
//   actionConfig:  { accountIds: string[], topics: string[], mode: "draft" | "auto", approval?: AutoApproval, extraPrompt?: string }
//     approval（mode: "auto" のときの自動承認の範囲）:
//       all      … 投稿前チェック・Jev の結果に関わらず自動承認して投稿（結果は記録のみ）
//       standard … NG（公開すべきでない）・Jev の hold だけ下書きに回し、それ以外は投稿
//       strict   … 投稿前チェックが OK かつ Jev を通過したものだけ投稿
//     standard / strict では、判定の障害（投稿前チェックの失敗・gate モードの Jev の失敗）は下書きに保留する。
//     画面・API からの作成/更新では approval の指定が必須（未指定の旧ルールはマイグレーションで all を明示保存済み）。
// worker が tick ごとに processDueRules() を呼び、nextRunAt を過ぎたルールを実行する。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getPlatform } from "../platforms";
import { generatePostText, reviewPost } from "./ai";
import { createPosts, errorMessage, returnToDraft } from "./publish";
import { jevConfig, markApplied, recordHumanAction } from "./decision";
import { judgePost, linkDecision, postGatePolicy } from "./post-decision";
import { assertBudget, withUsageContext } from "./usage";
import { scanQuoteCandidates, validateQuoteAction, type QuoteActionConfig } from "./quotes";
import { effectiveXPolicy, nextPostSlot } from "./x-policy";
import { enqueueArticleJob } from "./article-jobs";
import { getArticleTemplate, type ArticlePublishMode } from "./article-templates";

export type TriggerConfig =
  | { type: "daily"; times: string[]; timezone?: string }
  | { type: "interval"; hours: number };

export type AutoApproval = "all" | "standard" | "strict";
export const AUTO_APPROVALS: AutoApproval[] = ["all", "standard", "strict"];
export const APPROVAL_LABEL: Record<AutoApproval, string> = { all: "すべて自動承認", standard: "NGのみ保留", strict: "OKのみ投稿" };

export interface ActionConfig {
  accountIds: string[];
  topics: string[];
  mode: "draft" | "auto";
  /** mode: "auto" のときの自動承認の範囲（未指定は all） */
  approval?: AutoApproval;
  extraPrompt?: string;
}

/**
 * 自動投稿モードで、投稿前チェック（review）と Jev の判定から「自動承認して投稿するか」を決める。
 * publish: false のときは下書き（承認待ち）に回す。gateApplied は Jev の判定を処理に反映したか。
 */
export function autoApprovalDecision(
  approval: AutoApproval,
  review: { verdict: string; summary?: string; error?: string },
  jev?: { mode: "shadow" | "gate"; action: string; publish: boolean; reason: string },
  /** gate モードで Jev を呼んだが結果が返らなかった（障害） */
  jevFailed = false
): { publish: boolean; reason?: string; gateApplied: boolean } {
  const reviewWhy = () => (review.error ? `チェック失敗（${review.error.slice(0, 80)}）` : review.summary || review.verdict);
  const gate = jev?.mode === "gate" ? jev : undefined;
  if (approval === "all") return { publish: true, gateApplied: false };
  // 判定の障害は、自動承認の範囲を絞っている（standard / strict）ルールでは保留する
  if (review.verdict === "error") return { publish: false, reason: reviewWhy(), gateApplied: !!gate };
  if (jevFailed) return { publish: false, reason: "Jev の判定に失敗（判定障害のため保留）", gateApplied: false };
  if (approval === "standard") {
    if (review.verdict === "ng") return { publish: false, reason: reviewWhy(), gateApplied: !!gate };
    if (gate?.action === "hold") return { publish: false, reason: gate.reason, gateApplied: true };
    return { publish: true, gateApplied: !!gate };
  }
  if (review.verdict !== "ok") return { publish: false, reason: reviewWhy(), gateApplied: !!gate };
  if (gate && !gate.publish) return { publish: false, reason: gate.reason, gateApplied: true };
  return { publish: true, gateApplied: !!gate };
}

const DEFAULT_TZ = "Asia/Tokyo";

/** タイムゾーン tz における instant の UTC オフセット（分） */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** tz の暦日 (y, m, d) の hh:mm を UTC の Date に変換 */
function zonedTime(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m, d, hh, mm));
  const off = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off * 60_000);
  const off2 = tzOffsetMinutes(first, tz); // DST 境界の補正
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60_000);
}

export function validateTrigger(t: TriggerConfig): TriggerConfig {
  if (t.type === "interval") {
    const hours = Number(t.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 7) throw new ConfigError("間隔は1〜168時間で指定してください");
    return { type: "interval", hours };
  }
  if (t.type === "daily") {
    const times = [...new Set((t.times ?? []).map((x) => x.trim()).filter(Boolean))].sort();
    if (!times.length) throw new ConfigError("実行時刻を1つ以上指定してください（例: 09:00）");
    for (const x of times) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) throw new ConfigError(`時刻の形式が不正です: ${x}（HH:MM）`);
    const timezone = t.timezone || DEFAULT_TZ;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      throw new ConfigError(`タイムゾーンが不正です: ${timezone}`);
    }
    return { type: "daily", times, timezone };
  }
  throw new ConfigError("トリガーの種類が不正です");
}

/** from より後の次回実行時刻 */
export function nextRunAfter(t: TriggerConfig, from: Date): Date {
  if (t.type === "interval") return new Date(from.getTime() + t.hours * 3600_000);
  const tz = t.timezone || DEFAULT_TZ;
  const off = tzOffsetMinutes(from, tz);
  const local = new Date(from.getTime() + off * 60_000); // tz の壁時計を UTC フィールドに載せたもの
  for (let day = 0; day <= 2; day++) {
    for (const hm of t.times) {
      const [hh, mm] = hm.split(":").map(Number);
      const at = zonedTime(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, hh, mm, tz);
      if (at.getTime() > from.getTime()) return at;
    }
  }
  return new Date(from.getTime() + 24 * 3600_000);
}

/**
 * actionConfig の検証。requireApproval（画面・API からの作成/更新）では、自動投稿の承認範囲を明示しないとエラー。
 * 実行時（保存済みの旧ルール）は従来どおり未指定・不正を all として扱う。
 */
export function validateAction(a: ActionConfig, opts: { requireApproval?: boolean } = {}): ActionConfig {
  const accountIds = [...new Set(a.accountIds ?? [])];
  if (!accountIds.length) throw new ConfigError("投稿先アカウントを選択してください");
  const topics = (a.topics ?? []).map((t) => t.trim()).filter(Boolean);
  if (!topics.length) throw new ConfigError("トピックを1つ以上入力してください");
  const mode = a.mode === "auto" ? "auto" : "draft";
  const valid = AUTO_APPROVALS.includes(a.approval as AutoApproval);
  if (mode === "auto" && !valid && opts.requireApproval) throw new ConfigError("自動投稿では「自動承認の範囲」を選択してください");
  const approval = mode === "auto" ? (valid ? a.approval : "all") : undefined;
  return { accountIds, topics, mode, ...(approval ? { approval } : {}), extraPrompt: a.extraPrompt?.trim() || undefined };
}

export type RuleActionType = "generate_post" | "quote_post" | "note_article";

/** note 記事ルール: テーマを順に使い、テンプレートの型で 執筆 → 画像 → 見出し画像 → 入稿 まで全自動で行う */
export interface NoteArticleActionConfig {
  accountId: string;
  templateId: string;
  topics: string[];
  /** 入稿のしかた（省略時はテンプレートの設定） */
  publish?: ArticlePublishMode;
}

export function validateNoteArticleAction(a: Partial<NoteArticleActionConfig>): NoteArticleActionConfig {
  if (!a.accountId) throw new ConfigError("note アカウントを選択してください");
  if (!a.templateId) throw new ConfigError("記事テンプレートを選択してください");
  const topics = (a.topics ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (!topics.length) throw new ConfigError("テーマを1つ以上入力してください");
  return { accountId: a.accountId, templateId: a.templateId, topics, ...(a.publish === "publish" || a.publish === "draft" ? { publish: a.publish } : {}) };
}

export interface RuleInput {
  avatarId?: string;
  /** generate_post = AI で投稿文を生成（既定）/ quote_post = X の引用投稿（タイムラインから探して引用案を作る） */
  actionType?: RuleActionType;
  name?: string;
  description?: string;
  isActive?: boolean;
  clearError?: boolean;
  trigger?: TriggerConfig;
  action?: ActionConfig | QuoteActionConfig | NoteArticleActionConfig;
  /** 停止時に、このルールで自動承認されて予約キューにある投稿も止める（下書きに戻す） */
  holdQueued?: boolean;
}

/** ルールを作成する（画面・外部 API 共通） */
export async function createRule(b: RuleInput) {
  if (!b.avatarId) throw new ConfigError("アバターを選択してください");
  if (!b.name?.trim()) throw new ConfigError("ルール名を入力してください");
  if (!b.trigger || !b.action) throw new ConfigError("実行タイミングと動作を指定してください");
  const trigger = validateTrigger(b.trigger);
  const actionType: RuleActionType = b.actionType === "quote_post" || b.actionType === "note_article" ? b.actionType : "generate_post";
  const action = await validateRuleAction(actionType, b.avatarId, b.action);
  return prisma.automationRule.create({
    data: {
      avatarId: b.avatarId,
      name: b.name.trim(),
      description: b.description?.trim() || null,
      category: "posting",
      triggerType: "schedule",
      triggerConfig: trigger as object,
      actionType,
      actionConfig: action as object,
      nextRunAt: nextRunAfter(trigger, new Date()),
    },
  });
}

/** 画面・API からの作成/更新時の actionConfig の検証（種類ごと） */
async function validateRuleAction(actionType: RuleActionType, avatarId: string, raw: unknown): Promise<ActionConfig | QuoteActionConfig | NoteArticleActionConfig> {
  if (actionType === "note_article") {
    const n = validateNoteArticleAction(raw as NoteArticleActionConfig);
    await assertAccountsOf(avatarId, [n.accountId]);
    const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: n.accountId } });
    if (acc.platform !== "note") throw new ConfigError("note 記事ルールは note のアカウントだけに対応しています");
    await getArticleTemplate(n.templateId);
    return n;
  }
  if (actionType === "quote_post") {
    const q = validateQuoteAction(raw as QuoteActionConfig, { requireApproval: true });
    await assertAccountsOf(avatarId, [q.accountId]);
    const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: q.accountId } });
    if (acc.platform !== "x") throw new ConfigError("引用投稿ルールは X のアカウントだけに対応しています");
    return q;
  }
  const action = validateAction(raw as ActionConfig, { requireApproval: true });
  await assertAccountsOf(avatarId, action.accountIds);
  return action;
}

async function assertAccountsOf(avatarId: string, accountIds: string[]) {
  const accounts = await prisma.snsAccount.findMany({ where: { id: { in: accountIds } }, select: { avatarId: true } });
  if (accounts.length !== accountIds.length || accounts.some((a) => a.avatarId !== avatarId)) throw new ConfigError("選択したアカウントはこのアバターのものではありません");
}

/** ルールを更新する（画面・外部 API 共通）。保存後のルールと、下書きに戻した予約の件数を返す */
export async function updateRule(id: string, b: RuleInput) {
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id } });
  const trigger = b.trigger ? validateTrigger(b.trigger) : (rule.triggerConfig as unknown as TriggerConfig);
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name.trim() || rule.name;
  if (b.description !== undefined) data.description = b.description.trim() || null;
  if (b.trigger) data.triggerConfig = trigger;
  if (b.action) data.actionConfig = await validateRuleAction(rule.actionType as RuleActionType, rule.avatarId, b.action);
  if (b.isActive !== undefined) data.isActive = b.isActive;
  // 再開・スケジュール変更時は次回時刻を計算し直す
  if (b.trigger || (b.isActive && !rule.isActive)) data.nextRunAt = nextRunAfter(validateTrigger(trigger), new Date());
  if (b.isActive || b.clearError) data.lastError = null;
  const saved = await prisma.automationRule.update({ where: { id }, data: data as object });
  const held = b.isActive === false && b.holdQueued ? await holdQueuedPosts(id, `自動化「${saved.name}」の停止に合わせて予約を止めました`) : 0;
  return { rule: saved, held };
}

/** このルールで自動承認され、まだ送信されていない予約（pending）。停止時の影響範囲の表示用 */
export async function queuedPostsOfRule(ruleId: string) {
  return prisma.content.findMany({
    where: { status: "SCHEDULED", scheduledPost: { status: "pending" }, metadata: { path: ["automationId"], equals: ruleId } },
    select: { id: true, platform: true, content: true, scheduledPost: { select: { scheduledAt: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** ルールの予約を下書き（承認待ち）に戻す。戻した件数を返す */
export async function holdQueuedPosts(ruleId: string, reason: string): Promise<number> {
  const rows = await queuedPostsOfRule(ruleId);
  let n = 0;
  for (const r of rows) if (await returnToDraft(r.id, reason)) n++;
  return n;
}

/** ルールを1回実行する。作成した投稿数を返す。使用量は「自動化」としてアバター・ルールに紐付けて記録する */
export async function runRule(ruleId: string): Promise<number> {
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
  await assertBudget(`自動化「${rule.name}」`);
  if (rule.actionType === "quote_post") {
    // 引用投稿ルール: タイムラインから探して引用案を作る（設定はルールの actionConfig）
    const config = validateQuoteAction(rule.actionConfig as unknown as QuoteActionConfig);
    const r = await scanQuoteCandidates(config.accountId, { config, ruleId: rule.id, scheduled: true });
    if (r.errors.length && !r.drafted) throw new Error(`引用案の作成に失敗: ${r.errors[0]}`);
    return r.drafted;
  }
  if (rule.actionType === "note_article") {
    // 画像生成に数分かかるので、記事ジョブに依頼して戻る（結果は投稿一覧、失敗はルールのエラーに出る）
    const config = validateNoteArticleAction(rule.actionConfig as unknown as NoteArticleActionConfig);
    await getArticleTemplate(config.templateId);
    const topic = config.topics[rule.executionCount % config.topics.length];
    await enqueueArticleJob("full", rule.avatarId, { accountId: config.accountId, templateId: config.templateId, topic, publish: config.publish, ruleId: rule.id });
    return 1;
  }
  return withUsageContext({ avatarId: rule.avatarId, context: "automation", subjectId: rule.id }, () => runRuleInner(rule));
}

async function runRuleInner(rule: Awaited<ReturnType<typeof prisma.automationRule.findUniqueOrThrow>>): Promise<number> {
  const action = validateAction(rule.actionConfig as unknown as ActionConfig);
  const accounts = await prisma.snsAccount.findMany({ where: { id: { in: action.accountIds }, isActive: true } });
  if (!accounts.length) throw new ConfigError("有効な投稿先アカウントがありません（削除・停止されていないか確認してください）");
  const topic = action.topics[rule.executionCount % action.topics.length];

  // プラットフォームごとに文字数が違うので、プラットフォーム単位で生成する
  const byPlatform = new Map<string, typeof accounts>();
  for (const a of accounts) byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);

  let queued = 0;
  let drafted = 0;
  const held: string[] = [];
  const flagged: string[] = [];
  for (const [platform, accs] of byPlatform) {
    let heldReason: string;
    const { text, model, knowledgeIds } = await generatePostText({ avatarId: rule.avatarId, topic, platform, extraPrompt: action.extraPrompt, ruleId: rule.id });
    // Jev の判定（キーが無ければ null → 既存の流れのみ）。shadow は記録だけ、gate は自動投稿の可否に反映
    const jevCfg = await jevConfig();
    const jev = await judgePost({ avatarId: rule.avatarId, platform, text, topic });
    // gate モードで Jev を呼んだのに結果が無い = 判定障害（キー未設定・off なら jevCfg が null）
    const jevFailed = jevCfg?.mode === "gate" && !jev;
    const jevMeta = jev ? { action: jev.action, confidence: jev.confidence, mode: jev.mode, model: jev.model, ...postGatePolicy(jev) } : undefined;
    let review: { verdict: string; summary: string; model?: string; error?: string } | undefined;
    if (action.mode === "auto") {
      // 自動投稿の前に「投稿前チェック」を通す。どこまで自動承認するかはルールの approval で決める
      try {
        const r = await reviewPost({ text, avatarId: rule.avatarId, platform });
        review = { verdict: r.verdict, summary: r.summary, model: r.model };
      } catch (e) {
        review = { verdict: "error", summary: "", error: errorMessage(e) };
      }
      const approval = action.approval ?? "all";
      const d = autoApprovalDecision(approval, review, jev && jevMeta ? { mode: jev.mode, action: jev.action, publish: jevMeta.publish, reason: jevMeta.reason } : undefined, jevFailed);
      if (jev && d.gateApplied) await markApplied(jev.eventId);
      if (d.publish) {
        const extraMetadata = { automationId: rule.id, model, knowledgeIds, review, autoApproved: approval, ...(jevMeta ? { jev: jevMeta } : {}) };
        // X は、アバターの X API モードの回数・時刻の枠に予約する（1 日の回数はモードで固定、時刻は利用者が設定）
        const groups: { ids: string[]; scheduledAt?: Date }[] = [];
        const slotHeld: { acc: (typeof accs)[number]; reason: string }[] = [];
        if (platform === "x") {
          for (const a of accs) {
            const slot = await xPostSlot(a.id, a.avatarId);
            if (slot === "none" || slot === null) {
              slotHeld.push({ acc: a, reason: slot === "none" ? "X API のモードで通常投稿が 0 回のため、下書きにしました" : "今日・明日の投稿時刻の枠が埋まっているため、下書きにしました（予約を先へ積み上げない）" });
              continue;
            }
            groups.push({ ids: [a.id], scheduledAt: slot });
          }
        } else groups.push({ ids: accs.map((a) => a.id) });
        for (const h of slotHeld) {
          held.push(`${getPlatform(platform)?.name ?? platform}: ${h.reason}`);
          await prisma.content.create({
            data: {
              avatarId: h.acc.avatarId,
              platform,
              snsAccountId: h.acc.id,
              content: text,
              status: "DRAFT",
              category: "automation",
              metadata: { title: topic, media: [], options: {}, ...extraMetadata, autoApproved: undefined, ruleMode: action.mode, heldReason: h.reason } as object,
            },
          });
          drafted++;
        }
        for (const g of groups) {
          const posted = await createPosts({ accountIds: g.ids, text, title: topic, category: "automation", scheduledAt: g.scheduledAt, extraMetadata });
          if (jev && posted[0] && !queued) await linkDecision(jev.eventId, posted[0].id);
          queued += posted.length;
        }
        // チェックで指摘があっても自動承認した場合は、後から確認できるよう記録しておく
        if (review.verdict !== "ok") flagged.push(`${getPlatform(platform)?.name ?? platform}: ${review.error ? `チェック失敗（${review.error.slice(0, 80)}）` : `${review.verdict} ${review.summary}`.trim()}`);
        continue;
      }
      held.push(`${getPlatform(platform)?.name ?? platform}: ${d.reason}`);
      heldReason = `自動投稿ルール（${APPROVAL_LABEL[approval]}）で保留: ${d.reason ?? ""}`;
    } else {
      heldReason = "下書きモードのルールで作成（承認すると投稿）";
    }
    for (const [i, a] of accs.entries()) {
      const c = await prisma.content.create({
        data: {
          avatarId: a.avatarId,
          platform,
          snsAccountId: a.id,
          content: text,
          status: "DRAFT",
          category: "automation",
          metadata: { title: topic, media: [], options: {}, automationId: rule.id, ruleMode: action.mode, heldReason, model, knowledgeIds, ...(review ? { review } : {}), ...(jevMeta ? { jev: jevMeta } : {}) } as object,
        },
      });
      if (jev && i === 0) await linkDecision(jev.eventId, c.id);
      drafted++;
    }
  }
  const created = queued + drafted;

  if (held.length) {
    await prisma.activityLog.create({
      data: {
        avatarId: rule.avatarId,
        action: "automation_review_held",
        category: "content",
        level: "warning",
        description: `自動化「${rule.name}」: 保留して下書きに回しました — ${held.join(" / ")}`,
        metadata: { ruleId: rule.id },
      },
    });
  }

  if (flagged.length) {
    await prisma.activityLog.create({
      data: {
        avatarId: rule.avatarId,
        action: "automation_auto_approved",
        category: "content",
        level: "warning",
        description: `自動化「${rule.name}」: 投稿前チェックで指摘がありましたが、自動承認の設定により投稿しました — ${flagged.join(" / ")}`,
        metadata: { ruleId: rule.id },
      },
    });
  }

  await prisma.activityLog.create({
    data: {
      avatarId: rule.avatarId,
      action: "automation_completed",
      category: "content",
      level: "success",
      description: `自動化「${rule.name}」: トピック「${topic}」で${[queued && `${queued}件を投稿キューに追加`, drafted && `${drafted}件を下書き作成（承認待ち）`].filter(Boolean).join("、") || "0件"}しました`,
      metadata: { ruleId: rule.id, platforms: [...byPlatform.keys()].map((p) => getPlatform(p)?.name ?? p) },
    },
  });
  return created;
}

/**
 * X の通常投稿を予約する時刻。モードの時刻の空いている枠（そのアカウントの自動化の予約・投稿と重ならない）。
 * "none" = モードで通常投稿が 0 回。null = 今日・明日の枠が埋まっている（予約を先へ積み上げない）
 */
export async function xPostSlot(accountId: string, avatarId: string, now = new Date()): Promise<Date | null | "none"> {
  const { params } = await effectiveXPolicy(avatarId, now);
  if (params.postsPerDay <= 0) return "none";
  const since = new Date(now.getTime() - 24 * 3600_000);
  const rows = await prisma.content.findMany({
    where: {
      snsAccountId: accountId,
      category: "automation",
      status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] },
      OR: [{ scheduledPost: { scheduledAt: { gte: since } } }, { publishedAt: { gte: since } }],
    },
    select: { publishedAt: true, scheduledPost: { select: { scheduledAt: true } } },
  });
  const taken = rows.map((r) => r.scheduledPost?.scheduledAt ?? r.publishedAt).filter((d): d is Date => !!d);
  return nextPostSlot(params.postTimes, taken, now);
}

/** 期限の来たルールを実行（worker から定期実行）。二重実行しないよう nextRunAt を条件付き更新で確保する */
export async function processDueRules(): Promise<number> {
  const now = new Date();
  const due = await prisma.automationRule.findMany({
    // 一時停止中のアバターのルールは実行しない
    where: { isActive: true, actionType: { in: ["generate_post", "quote_post", "note_article"] }, nextRunAt: { lte: now }, avatar: { status: "ACTIVE" } },
    take: 5,
  });
  let n = 0;
  for (const rule of due) {
    let next: Date;
    try {
      next = nextRunAfter(validateTrigger(rule.triggerConfig as unknown as TriggerConfig), now);
    } catch (e) {
      await prisma.automationRule.update({ where: { id: rule.id }, data: { isActive: false, lastError: errorMessage(e) } });
      continue;
    }
    const claimed = await prisma.automationRule.updateMany({
      where: { id: rule.id, nextRunAt: rule.nextRunAt },
      data: { nextRunAt: next },
    });
    if (!claimed.count) continue;
    n++;
    try {
      await runRule(rule.id);
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { executionCount: { increment: 1 }, lastExecutedAt: new Date(), lastError: null },
      });
    } catch (e) {
      const msg = errorMessage(e);
      await prisma.automationRule.update({ where: { id: rule.id }, data: { lastExecutedAt: new Date(), lastError: msg } });
      await prisma.activityLog.create({
        data: { avatarId: rule.avatarId, action: "automation_failed", category: "content", level: "error", description: `自動化「${rule.name}」に失敗: ${msg.slice(0, 300)}` },
      });
    }
  }
  return n;
}

/** 下書きを承認して投稿キューに入れる（本文の修正も可） */
export async function approveDraft(contentId: string, text?: string, scheduledAt?: Date) {
  const c = await prisma.content.findUniqueOrThrow({ where: { id: contentId } });
  if (c.status !== "DRAFT") throw new ConfigError("下書き以外は承認できません");
  if (!c.snsAccountId) throw new ConfigError("投稿先アカウントがありません");
  await prisma.content.update({
    where: { id: contentId },
    data: {
      status: "SCHEDULED",
      // 人が承認した投稿は、送信直前の再確認でルールの状態を見ない（アカウント・アバターのみ確認）
      metadata: { ...((c.metadata ?? {}) as object), humanApprovedAt: new Date().toISOString() },
      ...(text?.trim() ? { content: text } : {}),
      scheduledPost: { create: { scheduledAt: scheduledAt ?? new Date(), status: "pending" } },
    },
  });
  // 判定（Jev 等）と人の判断を突き合わせるために記録。本文を直して承認した場合は区別する
  const edited = !!text?.trim() && text !== c.content;
  await recordHumanAction(contentId, edited ? "approved_edited" : "approved");
  await recordQuoteHumanAction(contentId, edited ? "approved_edited" : "approved");
}

/** 引用案の承認・却下を引用候補とその判定ログに反映する */
async function recordQuoteHumanAction(contentId: string, action: "approved" | "approved_edited" | "rejected") {
  const cands = await prisma.quoteCandidate.findMany({ where: { contentId }, select: { id: true } });
  for (const c of cands) {
    await recordHumanAction(c.id, action);
    await prisma.quoteCandidate.update({
      where: { id: c.id },
      data: action === "rejected" ? { status: "rejected", contentId: null } : { status: "approved" },
    });
  }
}

/** 未送信の投稿を削除する。下書きの削除は「人が却下した」として判定ログに記録する */
export async function discardContent(contentId: string) {
  const c = await prisma.content.findUniqueOrThrow({ where: { id: contentId } });
  if (c.status === "PUBLISHED" || c.status === "PUBLISHING") {
    throw new ConfigError("送信済み・送信中の投稿は削除できません（各SNS側で削除してください）");
  }
  if (c.status === "DRAFT") {
    await recordHumanAction(contentId, "rejected");
    await recordQuoteHumanAction(contentId, "rejected");
  }
  await prisma.content.delete({ where: { id: contentId } });
}
