// ================================================
// 自動化ルール — 「AIで投稿文を生成 → 下書き or（投稿前チェックを通過したら）自動投稿」を定期実行する
// ================================================
// AutomationRule の JSON 形式:
//   triggerConfig: { type: "daily", times: ["09:00","19:00"], timezone: "Asia/Tokyo" }
//                | { type: "interval", hours: 6 }
//   actionConfig:  { accountIds: string[], topics: string[], mode: "draft" | "auto", extraPrompt?: string }
// worker が tick ごとに processDueRules() を呼び、nextRunAt を過ぎたルールを実行する。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getPlatform } from "../platforms";
import { generatePostText, reviewPost } from "./ai";
import { createPosts, errorMessage } from "./publish";
import { markApplied, recordHumanAction } from "./decision";
import { judgePost, linkDecision, postGatePolicy } from "./post-decision";

export type TriggerConfig =
  | { type: "daily"; times: string[]; timezone?: string }
  | { type: "interval"; hours: number };

export interface ActionConfig {
  accountIds: string[];
  topics: string[];
  mode: "draft" | "auto";
  extraPrompt?: string;
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

export function validateAction(a: ActionConfig): ActionConfig {
  const accountIds = [...new Set(a.accountIds ?? [])];
  if (!accountIds.length) throw new ConfigError("投稿先アカウントを選択してください");
  const topics = (a.topics ?? []).map((t) => t.trim()).filter(Boolean);
  if (!topics.length) throw new ConfigError("トピックを1つ以上入力してください");
  return { accountIds, topics, mode: a.mode === "auto" ? "auto" : "draft", extraPrompt: a.extraPrompt?.trim() || undefined };
}

/** ルールを1回実行する。作成した投稿数を返す */
export async function runRule(ruleId: string): Promise<number> {
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
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
  for (const [platform, accs] of byPlatform) {
    const { text, model } = await generatePostText({ avatarId: rule.avatarId, topic, platform, extraPrompt: action.extraPrompt });
    // Jev の判定（キーが無ければ null → 既存の流れのみ）。shadow は記録だけ、gate は自動投稿の可否に反映
    const jev = await judgePost({ avatarId: rule.avatarId, platform, text, topic });
    const jevMeta = jev ? { action: jev.action, confidence: jev.confidence, mode: jev.mode, model: jev.model, ...postGatePolicy(jev) } : undefined;
    let review: { verdict: string; summary: string; model?: string; error?: string } | undefined;
    if (action.mode === "auto") {
      // 自動投稿の前に「投稿前チェック」を通す。ok 以外、またはチェック自体の失敗は下書きに回す（安全側）
      try {
        const r = await reviewPost({ text, avatarId: rule.avatarId, platform });
        review = { verdict: r.verdict, summary: r.summary, model: r.model };
      } catch (e) {
        review = { verdict: "error", summary: "", error: errorMessage(e) };
      }
      const gateBlocks = jev?.mode === "gate" && !jevMeta!.publish;
      if (jev?.mode === "gate") await markApplied(jev.eventId);
      if (review.verdict === "ok" && !gateBlocks) {
        const posted = await createPosts({
          accountIds: accs.map((a) => a.id),
          text,
          title: topic,
          category: "automation",
          extraMetadata: { automationId: rule.id, model, review, ...(jevMeta ? { jev: jevMeta } : {}) },
        });
        if (jev && posted[0]) await linkDecision(jev.eventId, posted[0].id);
        queued += posted.length;
        continue;
      }
      const why = review.verdict !== "ok" ? (review.error ? `チェック失敗（${review.error.slice(0, 80)}）` : review.summary || review.verdict) : jevMeta!.reason;
      held.push(`${getPlatform(platform)?.name ?? platform}: ${why}`);
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
          metadata: { title: topic, media: [], options: {}, automationId: rule.id, model, ...(review ? { review } : {}), ...(jevMeta ? { jev: jevMeta } : {}) } as object,
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
        description: `自動化「${rule.name}」: 投稿前チェックで保留し、下書きに回しました — ${held.join(" / ")}`,
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

/** 期限の来たルールを実行（worker から定期実行）。二重実行しないよう nextRunAt を条件付き更新で確保する */
export async function processDueRules(): Promise<number> {
  const now = new Date();
  const due = await prisma.automationRule.findMany({
    // 一時停止中のアバターのルールは実行しない
    where: { isActive: true, actionType: "generate_post", nextRunAt: { lte: now }, avatar: { status: "ACTIVE" } },
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
