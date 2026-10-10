// ================================================
// トピックの学習（反応の良いトピックを優先する） — 自動化ルール・X API モードの自動投稿で使う
// ================================================
// ・トピックの選び方: rotate（順番に使う・既定）/ learn（反応の良いトピックを優先）。
// ・learn: 公開から 20 時間以上たった指標（X は 24h 時点）の反応率で、トピックごとの平均を出す（改善処理の 7 日を待たずに学ぶ）。
//   試した回数が少ないトピックは先に試し、残りは「平均＋試行の少なさの加点」（UCB）が最大のものを選ぶ。
//   一定の割合（20%）は順番どおりに選び、新しい傾向も拾えるようにする。
// ・費用はかからない（DB にある指標だけを使う）。

import { prisma } from "@avatar-cmd/db";

export type TopicStrategy = "rotate" | "learn";
export const TOPIC_STRATEGY_LABEL: Record<TopicStrategy, string> = { rotate: "順番に使う", learn: "反応の良いトピックを優先（学習）" };

export const TOPIC_RULES = {
  /** 学習に使う期間 */
  windowDays: 60,
  /** 公開からの最低経過時間（X の 24h 時点の値を使う） */
  minObservedHours: 20,
  minViews: 30,
  /** これ未満の回数のトピックは先に試す */
  minTrials: 2,
  /** 順番どおりに選ぶ割合 */
  explore: 0.2,
};

export interface TopicStat {
  n: number;
  mean: number;
}

/** 次に使うトピックを選ぶ。index は順番に使う場合の位置（実行回数） */
export function pickTopic(topics: string[], stats: Map<string, TopicStat>, index: number, strategy: TopicStrategy = "rotate", rng: () => number = Math.random): string {
  const rotate = topics[index % topics.length];
  if (strategy !== "learn" || topics.length < 2) return rotate;
  // 試した回数が少ないトピックを、順番の位置から近い順に先に試す
  for (let i = 0; i < topics.length; i++) {
    const t = topics[(index + i) % topics.length];
    if ((stats.get(t)?.n ?? 0) < TOPIC_RULES.minTrials) return t;
  }
  if (rng() < TOPIC_RULES.explore) return rotate;
  const total = topics.reduce((s, t) => s + (stats.get(t)?.n ?? 0), 0);
  const overall = topics.reduce((s, t) => s + (stats.get(t)?.mean ?? 0) * (stats.get(t)?.n ?? 0), 0) / Math.max(1, total);
  let best = rotate;
  let bestScore = -Infinity;
  for (const t of topics) {
    const st = stats.get(t)!;
    // 加点の大きさは全体の平均反応率に合わせる（反応率の桁に依存しない）
    const score = st.mean + 0.5 * overall * Math.sqrt((2 * Math.log(Math.max(2, total))) / st.n);
    if (score > bestScore) [best, bestScore] = [t, score];
  }
  return best;
}

interface StatRow {
  publishedAt: Date | null;
  engagement: unknown;
  metadata: unknown;
}

/** 投稿の指標からトピックごとの平均反応率を出す（トピック = metadata.title） */
export function topicStats(rows: StatRow[], topics: string[]): Map<string, TopicStat> {
  const set = new Set(topics);
  const acc = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const title = (r.metadata as Record<string, unknown> | null)?.title;
    if (typeof title !== "string" || !set.has(title) || !r.publishedAt) continue;
    const e = (r.engagement ?? {}) as Record<string, unknown>;
    const views = typeof e.views === "number" ? e.views : 0;
    const eng = typeof e.engagements === "number" ? e.engagements : null;
    const fetchedAt = typeof e.fetchedAt === "string" ? Date.parse(e.fetchedAt) : NaN;
    if (eng === null || views < TOPIC_RULES.minViews || !Number.isFinite(fetchedAt)) continue;
    if ((fetchedAt - r.publishedAt.getTime()) / 3600_000 < TOPIC_RULES.minObservedHours) continue;
    const cur = acc.get(title) ?? { n: 0, sum: 0 };
    acc.set(title, { n: cur.n + 1, sum: cur.sum + eng / views });
  }
  return new Map([...acc].map(([t, v]) => [t, { n: v.n, mean: v.sum / v.n }]));
}

/** 自動化ルール、または X の自動投稿（アカウント）の投稿から、トピックごとの成績を読む */
export async function loadTopicStats(where: { ruleId?: string; xAutoAccountId?: string }, topics: string[], now = new Date()): Promise<Map<string, TopicStat>> {
  const since = new Date(now.getTime() - TOPIC_RULES.windowDays * 86400_000);
  const or = [
    ...(where.ruleId ? [{ metadata: { path: ["automationId"], equals: where.ruleId } }, { metadata: { path: ["sourceRuleId"], equals: where.ruleId } }] : []),
    ...(where.xAutoAccountId ? [{ snsAccountId: where.xAutoAccountId, metadata: { path: ["xModeAuto"], equals: true } }] : []),
  ];
  if (!or.length) return new Map();
  const rows = await prisma.content.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: since }, OR: or },
    select: { publishedAt: true, engagement: true, metadata: true },
    take: 1000,
  });
  return topicStats(rows, topics);
}
