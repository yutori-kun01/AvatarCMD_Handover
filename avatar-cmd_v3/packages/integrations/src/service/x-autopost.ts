// ================================================
// X API モードの自動投稿 — モードの時刻・回数で、人の承認なしに通常投稿する
// ================================================
// ・アバターの X API 設定「自動投稿」をオンにした X アカウントが対象（既定はオフ）。
// ・worker が定期的に呼び、モードの投稿時刻を過ぎて 30 分以内の枠で、まだ投稿していなければ 1 件生成して投稿キューに入れる。
//   止まっていた間の枠はさかのぼらない。同じ枠（前後 30 分）に予約・投稿済みの自動投稿があれば作らない。
// ・内容のトピック: 自動投稿のトピック → このアカウントを投稿先にした自動化ルール（投稿文の生成）のトピックと追加の指示 → ペルソナのトピック。
//   自動投稿がオンの X アカウントには、自動化ルールは投稿文を作らない（ルールの内容はここで使う。二重に投稿しない）。
// ・投稿前チェック・Jev の結果は記録する。承認範囲（all / standard / strict）は自動化ルールと同じ判定（autoApprovalDecision）。

import { prisma } from "@avatar-cmd/db";
import { generatePostText, readPersona, reviewPost } from "./ai";
import { autoApprovalDecision, type ActionConfig } from "./automation";
import { jevConfig, markApplied } from "./decision";
import { judgePost, linkDecision, postGatePolicy } from "./post-decision";
import { createPosts, errorMessage } from "./publish";
import { assertBudget, withUsageContext } from "./usage";
import { dueAutoPostSlot, effectiveXPolicy, getXPolicy, saveXPolicy, TIME_TUNE_RULES, tunePostTimes, type XAutoPost } from "./x-policy";
import { loadTopicStats, pickTopic } from "./topic-bandit";

const SLOT_WINDOW_MS = 30 * 60_000;

export interface AutoPostTopic {
  topic: string;
  extraPrompt?: string;
  ruleId?: string;
}

/** 自動投稿のトピック候補（自動投稿のトピック → 自動化ルール → ペルソナ） */
export async function autoPostTopics(accountId: string, avatarId: string, autoPost: Pick<XAutoPost, "topics">): Promise<AutoPostTopic[]> {
  if (autoPost.topics.length) return autoPost.topics.map((topic) => ({ topic }));
  const rules = await prisma.automationRule.findMany({
    where: { avatarId, actionType: "generate_post", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, actionConfig: true },
  });
  const fromRules: AutoPostTopic[] = [];
  for (const r of rules) {
    const a = r.actionConfig as unknown as Partial<ActionConfig>;
    if (!a.accountIds?.includes(accountId)) continue;
    for (const t of a.topics ?? []) if (t.trim()) fromRules.push({ topic: t.trim(), extraPrompt: a.extraPrompt, ruleId: r.id });
  }
  if (fromRules.length) return fromRules;
  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId }, select: { communication: true } });
  return (readPersona(avatar?.communication).topics ?? []).filter(Boolean).map((topic) => ({ topic }));
}

/** 自動投稿がオンの X アカウントで、投稿時刻の来たものを投稿する（worker から定期実行）。作成した件数を返す */
export async function processXModePosts(now = new Date()): Promise<number> {
  const accounts = await prisma.snsAccount.findMany({ where: { platform: "x", isActive: true, avatar: { status: "ACTIVE" } } });
  let n = 0;
  const tuned = new Set<string>();
  for (const acc of accounts) {
    try {
      if (!tuned.has(acc.avatarId)) {
        tuned.add(acc.avatarId);
        await tuneXPostTimes(acc.avatarId, now);
      }
      const { setting, params } = await effectiveXPolicy(acc.avatarId, now);
      if (!setting.autoPost.enabled || params.postsPerDay <= 0) continue;
      const settings = (acc.settings ?? {}) as Record<string, unknown>;
      const last = typeof settings.xAutoPostSlot === "string" ? new Date(settings.xAutoPostSlot) : null;
      const slot = dueAutoPostSlot(params.postTimes, last, now);
      if (!slot) continue;
      // 先に枠を確保する（失敗しても同じ枠で繰り返し生成・課金しない）
      const count = Number(settings.xAutoPostCount) || 0;
      await prisma.snsAccount.update({ where: { id: acc.id }, data: { settings: { ...settings, xAutoPostSlot: slot.toISOString(), xAutoPostCount: count + 1 } as object } });
      if (await slotTaken(acc.id, slot)) continue;
      n += await runXModePost(acc, setting.autoPost, slot, count);
    } catch (e) {
      const msg = errorMessage(e);
      await prisma.snsAccount.update({ where: { id: acc.id }, data: { lastError: msg.slice(0, 300) } }).catch(() => undefined);
      await prisma.activityLog.create({
        data: { avatarId: acc.avatarId, action: "x_autopost_failed", category: "content", level: "error", description: `X (${acc.accountName}) の自動投稿に失敗: ${msg.slice(0, 300)}` },
      });
    }
  }
  return n;
}

/** 同じ枠（前後 30 分）に自動投稿の予約・投稿があるか */
async function slotTaken(accountId: string, slot: Date): Promise<boolean> {
  const from = new Date(slot.getTime() - SLOT_WINDOW_MS);
  const to = new Date(slot.getTime() + SLOT_WINDOW_MS);
  const n = await prisma.content.count({
    where: {
      snsAccountId: accountId,
      category: "automation",
      status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] },
      OR: [{ scheduledPost: { scheduledAt: { gte: from, lte: to } } }, { publishedAt: { gte: from, lte: to } }],
    },
  });
  return n > 0;
}

async function runXModePost(acc: { id: string; avatarId: string; accountName: string }, autoPost: XAutoPost, slot: Date, count: number): Promise<number> {
  const topics = await autoPostTopics(acc.id, acc.avatarId, autoPost);
  if (!topics.length) throw new Error("トピックがありません（X API 設定の自動投稿のトピック・自動化ルール・ペルソナのトピックのどれかを設定してください）");
  // 同じトピックが複数のルールにあれば最初のもの（追加の指示もそのルールのもの）を使う
  const names = [...new Set(topics.map((x) => x.topic))];
  const stats = autoPost.topicStrategy === "learn" ? await loadTopicStats({ xAutoAccountId: acc.id }, names) : new Map();
  const name = pickTopic(names, stats, count, autoPost.topicStrategy);
  const t = topics.find((x) => x.topic === name)!;
  await assertBudget(`X (${acc.accountName}) の自動投稿`);
  return withUsageContext({ avatarId: acc.avatarId, context: "automation", subjectId: t.ruleId ?? acc.id }, async () => {
    const { text, model, knowledgeIds } = await generatePostText({ avatarId: acc.avatarId, topic: t.topic, platform: "x", extraPrompt: t.extraPrompt, ruleId: t.ruleId });
    const jevCfg = await jevConfig();
    const jev = await judgePost({ avatarId: acc.avatarId, platform: "x", text, topic: t.topic });
    const jevFailed = jevCfg?.mode === "gate" && !jev;
    const jevMeta = jev ? { action: jev.action, confidence: jev.confidence, mode: jev.mode, model: jev.model, ...postGatePolicy(jev) } : undefined;
    let review: { verdict: string; summary: string; model?: string; error?: string };
    try {
      const r = await reviewPost({ text, avatarId: acc.avatarId, platform: "x" });
      review = { verdict: r.verdict, summary: r.summary, model: r.model };
    } catch (e) {
      review = { verdict: "error", summary: "", error: errorMessage(e) };
    }
    const d = autoApprovalDecision(autoPost.approval, review, jev && jevMeta ? { mode: jev.mode, action: jev.action, publish: jevMeta.publish, reason: jevMeta.reason } : undefined, jevFailed);
    if (jev && d.gateApplied) await markApplied(jev.eventId);
    const meta = { xModeAuto: true, sourceRuleId: t.ruleId, model, knowledgeIds, review, ...(jevMeta ? { jev: jevMeta } : {}) };
    if (d.publish) {
      const [post] = await createPosts({ accountIds: [acc.id], text, title: t.topic, category: "automation", scheduledAt: new Date(), extraMetadata: { ...meta, autoApproved: autoPost.approval } });
      if (jev && post) await linkDecision(jev.eventId, post.id);
      await prisma.activityLog.create({
        data: {
          avatarId: acc.avatarId,
          action: "x_autopost",
          category: "content",
          level: review.verdict === "ok" ? "success" : "warning",
          description: `X (${acc.accountName}) の自動投稿（${slot.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })} の枠）: トピック「${t.topic}」を投稿キューに追加${review.verdict === "ok" ? "" : `（投稿前チェック: ${review.error ? "失敗" : review.verdict} ${review.summary}）`}`,
          metadata: { accountId: acc.id, ruleId: t.ruleId ?? null },
        },
      });
      return 1;
    }
    const c = await prisma.content.create({
      data: {
        avatarId: acc.avatarId,
        platform: "x",
        snsAccountId: acc.id,
        content: text,
        status: "DRAFT",
        category: "automation",
        metadata: { title: t.topic, media: [], options: {}, ...meta, heldReason: `X の自動投稿で保留: ${d.reason ?? ""}` } as object,
      },
    });
    if (jev) await linkDecision(jev.eventId, c.id);
    await prisma.activityLog.create({
      data: { avatarId: acc.avatarId, action: "automation_review_held", category: "content", level: "warning", description: `X (${acc.accountName}) の自動投稿: 保留して下書きに回しました — ${d.reason ?? ""}`, metadata: { accountId: acc.id } },
    });
    return 1;
  });
}

/**
 * 投稿時刻の見直し（自動投稿の「時刻を調整」がオンのアバターで週 1 回）。
 * このアバターの X の通常投稿（引用は除く）の 24h 時点の反応率を時間帯ごとに比べ、良い方へ 30 分寄せる。回数は変えない。
 */
export async function tuneXPostTimes(avatarId: string, now = new Date()): Promise<{ from: string; to: string }[]> {
  const setting = await getXPolicy(avatarId);
  const a = setting.autoPost;
  if (!a.enabled || !a.tuneTimes) return [];
  if (a.timesTunedAt && now.getTime() - Date.parse(a.timesTunedAt) < TIME_TUNE_RULES.everyDays * 86400_000) return [];
  const { params } = await effectiveXPolicy(avatarId, now);
  const rows = await prisma.content.findMany({
    where: { avatarId, platform: "x", status: "PUBLISHED", category: { not: "quote" }, publishedAt: { gte: new Date(now.getTime() - 60 * 86400_000) } },
    select: { publishedAt: true, engagement: true },
  });
  const acc = new Map<number, { n: number; sum: number }>();
  for (const r of rows) {
    const e = (r.engagement ?? {}) as Record<string, unknown>;
    const views = typeof e.views === "number" ? e.views : 0;
    const eng = typeof e.engagements === "number" ? e.engagements : null;
    const fetchedAt = typeof e.fetchedAt === "string" ? Date.parse(e.fetchedAt) : NaN;
    if (!r.publishedAt || eng === null || views < 30 || !Number.isFinite(fetchedAt) || fetchedAt - r.publishedAt.getTime() < 20 * 3600_000) continue;
    const h = new Date(r.publishedAt.getTime() + 9 * 3600_000).getUTCHours();
    const cur = acc.get(h) ?? { n: 0, sum: 0 };
    acc.set(h, { n: cur.n + 1, sum: cur.sum + eng / views });
  }
  const byHour = new Map([...acc].map(([h, v]) => [h, { n: v.n, mean: v.sum / v.n }]));
  const { times, moved } = tunePostTimes(params.postTimes, byHour);
  const autoPost = { ...a, timesTunedAt: now.toISOString() };
  if (!moved.length) {
    await saveXPolicy(avatarId, { autoPost });
    return [];
  }
  await saveXPolicy(avatarId, setting.mode === "custom" ? { autoPost, custom: { ...setting.custom, postTimes: times } } : { autoPost, times: { ...setting.times, post: times } });
  await prisma.activityLog.create({
    data: { avatarId, action: "x_post_times_tuned", category: "content", level: "info", description: `X の投稿時刻を反応の良い時間帯へ調整: ${moved.map((m) => `${m.from} → ${m.to}`).join("、")}` },
  });
  return moved;
}
