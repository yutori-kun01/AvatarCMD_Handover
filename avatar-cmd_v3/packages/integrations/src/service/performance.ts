// ================================================
// 改善か継続かの判定 — 自動化ルールごとに投稿の反応を評価する
// ================================================
// ・数値の集計と比較はコードで行う（中央値・比率・件数）。
// ・「継続 / 改善 / 停止」と「改善するなら何を変えるか」の判断は Jev（設定があれば）。
//   キーが無ければコードのルール（ruleVerdict）だけで判定する。
// ・判定は提案として表示するだけで、ルールを自動では書き換えない（人が判断して変更する）。

import { choice, noul } from "@typesafe-ai/sdk";
import { prisma } from "@avatar-cmd/db";
import { getPlatform } from "../platforms";
import { decideWithJev, logDecision, topChoice } from "./decision";
import type { ActionConfig } from "./automation";

const DAY = 86400_000;
export const PERFORMANCE_WINDOW_DAYS = 30;
/** 判定に必要な最低件数（指標が取れている投稿） */
export const MIN_POSTS = 3;

export type Verdict = "continue" | "improve" | "stop" | "insufficient";
export type ImproveFocus = "hook" | "topic" | "format" | "timing" | "length" | "none";

export const VERDICT_LABEL: Record<Verdict, string> = {
  continue: "継続",
  improve: "改善",
  stop: "停止を検討",
  insufficient: "データ不足",
};
export const FOCUS_LABEL: Record<ImproveFocus, string> = {
  hook: "書き出し（最初の一文）",
  topic: "トピック選び",
  format: "形式（箇条書き・質問・体験談など）",
  timing: "投稿時間帯",
  length: "長さ",
  none: "特になし",
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface MetricRow {
  id: string;
  text: string;
  topic?: string;
  platform: string;
  publishedAt: Date;
  views?: number;
  engagements: number;
  engagementRate: number | null;
}

/** 反応の比較に使う値: 表示回数が取れていれば反応率、無ければ反応数 */
function scoreOf(r: MetricRow, useRate: boolean): number {
  return useRate ? r.engagementRate ?? 0 : r.engagements;
}

export interface PerformanceStats {
  posts: number;
  baselinePosts: number;
  /** "rate"（反応率）または "count"（反応数） */
  basis: "rate" | "count";
  ruleMedian: number | null;
  baselineMedian: number | null;
  /** ルールの中央値 ÷ 比較対象の中央値 */
  ratio: number | null;
  /** 比較対象: other = 同じアバターの他の投稿 / trend = このルールの前半 */
  baseline: "other" | "trend";
  byTopic: { topic: string; posts: number; median: number | null }[];
  byHour: { hour: number; posts: number; median: number | null }[];
}

/** コードのルールによる判定（Jev が無いときの判定、Jev と比較するための基準） */
export function ruleVerdict(s: Pick<PerformanceStats, "posts" | "ratio">): Verdict {
  if (s.posts < MIN_POSTS || s.ratio === null) return "insufficient";
  if (s.ratio >= 0.9) return "continue";
  if (s.ratio < 0.5 && s.posts >= 8) return "stop";
  return "improve";
}

export function computeStats(rule: MetricRow[], others: MetricRow[]): PerformanceStats {
  const all = [...rule, ...others];
  // 表示回数がほぼ全件で取れているなら反応率、そうでなければ反応数で比べる
  const basis: "rate" | "count" = all.length && all.filter((r) => r.engagementRate !== null).length >= all.length * 0.8 ? "rate" : "count";
  const useRate = basis === "rate";
  let baseline: "other" | "trend" = "other";
  let target = rule;
  let base = others;
  if (others.length < MIN_POSTS && rule.length >= MIN_POSTS * 2) {
    // 他に比較できる投稿が無いときは、このルールの新しい半分と古い半分を比べる（伸びているか落ちているか）
    const sorted = [...rule].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    const half = Math.floor(sorted.length / 2);
    base = sorted.slice(0, half);
    target = sorted.slice(half);
    baseline = "trend";
  }
  const ruleMedian = median(target.map((r) => scoreOf(r, useRate)));
  const baselineMedian = median(base.map((r) => scoreOf(r, useRate)));
  const ratio = ruleMedian !== null && baselineMedian !== null && base.length >= MIN_POSTS ? (baselineMedian > 0 ? ruleMedian / baselineMedian : ruleMedian > 0 ? 2 : 1) : null;

  const group = <K extends string | number>(key: (r: MetricRow) => K | undefined) => {
    const m = new Map<K, number[]>();
    for (const r of rule) {
      const k = key(r);
      if (k === undefined) continue;
      m.set(k, [...(m.get(k) ?? []), scoreOf(r, useRate)]);
    }
    return [...m].map(([k, xs]) => ({ k, posts: xs.length, median: median(xs) }));
  };
  return {
    posts: target.length,
    baselinePosts: base.length,
    basis,
    ruleMedian,
    baselineMedian,
    ratio,
    baseline,
    byTopic: group((r) => r.topic).map(({ k, ...x }) => ({ topic: k, ...x })),
    byHour: group((r) => new Date(r.publishedAt.getTime() + 9 * 3600_000).getUTCHours()).map(({ k, ...x }) => ({ hour: k, ...x })).sort((a, b) => a.hour - b.hour),
  };
}

function toRow(c: { id: string; content: string; platform: string; publishedAt: Date | null; engagement: unknown; metadata: unknown }): MetricRow | null {
  const e = (c.engagement ?? {}) as Record<string, unknown>;
  if (typeof e.engagements !== "number" || !c.publishedAt) return null;
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return {
    id: c.id,
    text: c.content,
    topic: typeof meta.title === "string" ? meta.title : undefined,
    platform: c.platform,
    publishedAt: c.publishedAt,
    views: typeof e.views === "number" ? e.views : undefined,
    engagements: e.engagements,
    engagementRate: typeof e.engagementRate === "number" ? e.engagementRate : null,
  };
}

export interface PerformanceResult {
  ruleId: string;
  verdict: Verdict;
  ruleVerdict: Verdict;
  focus: ImproveFocus | null;
  confidence: number | null;
  engine: "jev" | "rule";
  stats: PerformanceStats;
  eventId: string;
  createdAt: Date;
}

/** 自動化ルール1件の反応を評価して判定する（判定は DecisionEvent に記録） */
export async function evaluateRulePerformance(ruleId: string): Promise<PerformanceResult> {
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
  const since = new Date(Date.now() - PERFORMANCE_WINDOW_DAYS * DAY);
  const contents = await prisma.content.findMany({
    where: { avatarId: rule.avatarId, status: "PUBLISHED", publishedAt: { gte: since } },
    select: { id: true, content: true, platform: true, publishedAt: true, engagement: true, metadata: true },
  });
  const isRule = (c: { metadata: unknown }) => ((c.metadata ?? {}) as Record<string, unknown>).automationId === rule.id;
  const ruleRows = contents.filter(isRule).map(toRow).filter((r): r is MetricRow => !!r);
  // 比較対象は同じプラットフォームの投稿に限る（プラットフォーム間で数字の桁が違うため）
  const platforms = new Set(ruleRows.map((r) => r.platform));
  const otherRows = contents.filter((c) => !isRule(c) && platforms.has(c.platform)).map(toRow).filter((r): r is MetricRow => !!r);
  const stats = computeStats(ruleRows, otherRows);
  const base = ruleVerdict(stats);

  const action = rule.actionConfig as unknown as ActionConfig;
  // 良い・悪い投稿の例は、比較に使った基準（反応率 or 反応数）で並べる
  const useRate = stats.basis === "rate";
  const sorted = [...ruleRows].sort((a, b) => scoreOf(b, useRate) - scoreOf(a, useRate));
  const sample = (rows: MetricRow[]) =>
    rows.map((r) => ({ text: r.text.slice(0, 400), topic: r.topic ?? null, platform: getPlatform(r.platform)?.name ?? r.platform, views: r.views ?? null, engagements: r.engagements, engagementRate: r.engagementRate }));
  const state = {
    rule: { name: rule.name, topics: action.topics ?? [], extraPrompt: action.extraPrompt ?? null, mode: action.mode },
    stats,
    ruleBasedVerdict: base,
    bestPosts: sample(sorted.slice(0, 3)),
    worstPosts: sample(sorted.slice(-3).reverse()),
  };

  const jev =
    base === "insufficient"
      ? null // データ不足なら Jev は呼ばない（コストを使っても結論が出ない）
      : await decideWithJev(
          { decisionType: "performance", avatarId: rule.avatarId, subjectId: rule.id },
          state,
          {
            verdict: choice("Based on the engagement statistics and example posts, what should happen to this automated posting rule?", {
              continue: "Performance is at or above the account's baseline; keep the rule as it is.",
              improve: "Performance is below baseline or declining, but the theme has potential; keep the rule and change how posts are written or scheduled.",
              stop: "Performance is persistently and clearly poor with enough data; pause the rule and rethink the theme.",
            }),
            focus: choice("If this rule should be improved, which single change would most likely raise engagement?", {
              hook: "The opening line fails to catch attention.",
              topic: "Some topics in the rotation perform much worse than others.",
              format: "The structure (list, question, story, tips) should change.",
              timing: "Posting hours perform poorly compared with better hours.",
              length: "Posts are too long or too short for the platform.",
              none: "No change is needed.",
            }),
            enoughData: noul("The statistics contain enough posts to support a reliable conclusion."),
          },
          (a) => topChoice(a.verdict)
        );

  let verdict: Verdict = base;
  let focus: ImproveFocus | null = null;
  let confidence: number | null = null;
  let eventId: string;
  if (jev) {
    const v = topChoice(jev.answers.verdict);
    // Jev 自身が「データ不足」と見た場合はコードの判定を優先する
    verdict = jev.answers.enoughData.noul < 0.5 ? base : (v.action as Verdict);
    focus = verdict === "continue" ? null : (jev.answers.focus.choice as ImproveFocus);
    confidence = v.confidence ?? null;
    eventId = jev.eventId;
  } else {
    eventId = await logDecision(
      { decisionType: "performance", avatarId: rule.avatarId, subjectId: rule.id },
      { engine: "rule", state, answers: { verdict: base }, action: base }
    );
  }
  return { ruleId: rule.id, verdict, ruleVerdict: base, focus, confidence, engine: jev ? "jev" : "rule", stats, eventId, createdAt: new Date() };
}

/** 各ルールの最新の判定（画面表示用） */
export async function latestPerformance(ruleIds: string[]) {
  const rows = await prisma.decisionEvent.findMany({
    where: { decisionType: "performance", subjectId: { in: ruleIds }, error: null },
    orderBy: { createdAt: "desc" },
  });
  const out: Record<string, { verdict: Verdict; focus: ImproveFocus | null; confidence: number | null; engine: string; stats: PerformanceStats | null; createdAt: Date }> = {};
  for (const r of rows) {
    if (!r.subjectId || out[r.subjectId]) continue;
    const answers = (r.answers ?? {}) as Record<string, any>;
    const state = (r.state ?? {}) as Record<string, any>;
    const base = (state.ruleBasedVerdict ?? answers.verdict) as Verdict;
    const jevVerdict = r.engine === "jev" ? (answers.enoughData?.noul < 0.5 ? base : (answers.verdict?.choice as Verdict)) : base;
    out[r.subjectId] = {
      verdict: jevVerdict ?? base,
      focus: r.engine === "jev" && jevVerdict !== "continue" ? ((answers.focus?.choice as ImproveFocus) ?? null) : null,
      confidence: r.confidence,
      engine: r.engine,
      stats: (state.stats as PerformanceStats) ?? null,
      createdAt: r.createdAt,
    };
  }
  return out;
}

/** 有効なルールを1日1回評価する（worker から呼ぶ）。評価した件数を返す */
export async function processPerformanceReviews(): Promise<number> {
  const rules = await prisma.automationRule.findMany({ where: { isActive: true, actionType: "generate_post" }, select: { id: true } });
  const latest = await latestPerformance(rules.map((r) => r.id));
  let n = 0;
  for (const r of rules) {
    const last = latest[r.id]?.createdAt;
    if (last && Date.now() - last.getTime() < DAY) continue;
    try {
      await evaluateRulePerformance(r.id);
      n++;
    } catch (e) {
      console.error(`[performance] rule ${r.id}:`, e);
    }
  }
  return n;
}
