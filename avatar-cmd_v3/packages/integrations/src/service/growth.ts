// ================================================
// 成長アルゴリズム — アカウントの成長フェーズを帯で判定し、改善ループの判定値・探索の度合いを評価のたびに自動で調整する
// ================================================
// 1. 帯（フェーズ）: 投稿あたりの表示回数（中央値）・フォロワー数・反応率・フォロー率・拡散率を、決めた区切りで帯に分ける。
//    境界の近くで行ったり来たりしないよう、帯を移るのは境界を一定以上（HYSTERESIS）越えたときだけ。
// 2. 到達レベル（0〜10）: 表示回数とフォロワー数の帯（帯の中の位置まで含めた連続値）から決める。
//    レベルで改善ループの設定値（間隔・比較に使う最低表示回数・最低件数・探索の割合・自動適用の可否）を連続的に変える。
// 3. 媒体ごとの判定値（PLATFORM_PROFILES）: 指標の重み・指標が出そろう日数の初期値。出そろう日数は時点ごとの指標から実測で学習する。
// 4. 自動調整（評価のたび。worker から 1 日 1 回）:
//    ・基準値（このアカウントの「ふつう」の表示回数・反応率・拡散率）を指数移動平均で更新する（絶対値ではなく自分比で判断する）
//    ・伸びは「証拠がたまったら比べる」時計で判定する（日数で区切らない）:
//        前回の比較の後に出そろった投稿（新しいまとまり）と、前回のまとまりを比べる。
//        必要件数 n = (1.64 × σ / δ)²。σ = このアカウントの投稿スコアのばらつき（実測で学習）、δ = 見逃したくない変化幅（約 15%）。
//        投稿が多いアカウントは早く、少ないアカウントは長く待って比べる（下限は出そろう日数 + 1 日、上限 28 日。上限で比べたときは確度が低いと表示）。
//      伸びていれば探索を減らし（活用）、停滞・下降なら探索を増やす（温度）。件数不足のまま比べた停滞は、停滞として数えない
//    ・トピック変更などを適用した後は、変更後の投稿が必要件数たまるまで比べない（変更の効果が出る前に次の調整をしない）
//    ・比べるときだけ Jev（設定があれば）に「本物の変化か・一時的な外れ値か」「比べる間隔を速める・維持・遅らせる・様子見」を判定させる。
//      shadow は記録だけ。gate では コードのポリシー（reviewPolicy）の範囲で反映する（様子見は連続 1 回まで、間隔の倍率は 0.5〜2 倍）
//    ・「良い投稿」の基準（margin）は、投稿のスコアの上位 4 割が「良い」になるよう追従させる
//    ・トピックごとの成績（ベータ分布）は、指標が出そろった投稿で更新し、評価のたびに少しずつ忘れる（環境の変化に追従）
// 5. 使い道: 改善処理（improvement.ts）の判定値と間隔（投稿ペースと必要件数から）・自動適用の可否、自動化ルールのトピック選び（topicStrategy: "growth"）。
// 帯の区切り・重みはコードで管理する。数値の抽出・判定はすべてプログラムで行い、AI は使わない（費用なし）。

import { prisma } from "@avatar-cmd/db";
import { getPlatform } from "../platforms";
import { choice } from "@typesafe-ai/sdk";
import { decideWithJev, markApplied, topChoice } from "./decision";

const DAY = 86400_000;

// --- 帯 ------------------------------------------------------------------------------------

export const GROWTH_BANDS = {
  /** 投稿あたりの表示回数（直近の中央値） */
  views: [0, 100, 500, 2_000, 10_000, 30_000, 100_000, 300_000, 1_000_000, 5_000_000, 10_000_000],
  followers: [0, 100, 500, 1_000, 2_000, 3_000, 5_000, 10_000, 30_000, 50_000, 100_000],
  /** 反応率（反応数 / 表示回数） */
  engagementRate: [0, 0.01, 0.03, 0.05, 0.1, 0.2, 0.3, 0.4],
  /** フォロー率（期間中に増えたフォロワー / 期間中の表示回数） */
  followRate: [0, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05],
  /** 拡散率（リポスト・引用・シェア / 表示回数） */
  spreadRate: [0, 0.001, 0.003, 0.005, 0.01, 0.02, 0.03, 0.05],
} as const;
export type GrowthMetric = keyof typeof GROWTH_BANDS;
export const GROWTH_METRIC_LABEL: Record<GrowthMetric, string> = { views: "表示回数", followers: "フォロワー", engagementRate: "反応率", followRate: "フォロー率", spreadRate: "拡散率" };

/** 境界をこの割合だけ越えるまでは、前の帯にとどまる */
export const HYSTERESIS = 0.08;

/** 値の帯（0 始まり）。prev があれば境界付近では前の帯にとどまる */
export function bandOf(value: number, edges: readonly number[], prev?: number | null): number {
  let raw = 0;
  for (let i = 0; i < edges.length; i++) if (value >= edges[i]) raw = i;
  if (prev === undefined || prev === null || prev === raw || prev < 0 || prev >= edges.length) return raw;
  if (raw > prev) {
    // 上がる: 1 つ上の境界を HYSTERESIS 以上越えた帯まで
    let b = prev;
    while (b + 1 <= raw && value >= edges[b + 1] * (1 + HYSTERESIS)) b++;
    return b;
  }
  // 下がる: 今の帯の下限を HYSTERESIS 以上下回ったときだけ
  let b = prev;
  while (b - 1 >= raw && value < edges[b] * (1 - HYSTERESIS)) b--;
  return b;
}

/** 帯の中の位置まで含めた連続値（0〜帯の数）。帯の中は対数で補間する */
export function bandPosition(value: number, edges: readonly number[]): number {
  const b = bandOf(value, edges);
  const lo = edges[b];
  const hi = edges[b + 1];
  if (hi === undefined) return b + 0.5;
  const frac = lo <= 0 ? Math.log1p(value) / Math.log1p(hi) : Math.log(value / lo) / Math.log(hi / lo);
  return b + Math.max(0, Math.min(0.999, frac));
}

const fmtNum = (n: number) => (n >= 10_000 ? `${(n / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万` : n.toLocaleString("ja-JP"));
const fmtPct = (r: number) => `${Number((r * 100).toFixed(2))}%`;

/** 帯の表示（例: 「500〜2,000」「1000万〜」「3%〜5%」） */
export function bandLabel(metric: GrowthMetric, band: number): string {
  const e = GROWTH_BANDS[metric];
  const f = metric === "views" || metric === "followers" ? fmtNum : fmtPct;
  return e[band + 1] === undefined ? `${f(e[band])}〜` : `${f(e[band])}〜${f(e[band + 1])}`;
}

// --- 媒体ごとの判定値 ---------------------------------------------------------------------

export interface GrowthWeights {
  reach: number;
  engagement: number;
  spread: number;
  follow: number;
}

export interface PlatformProfile {
  /** 伸びの評価・投稿のスコアに使う重み */
  weights: GrowthWeights;
  /** 指標がほぼ出そろうまでの日数（初期値。時点ごとの指標から学習して置き換える） */
  settleDays: number;
}

/** 媒体の性質による初期値。以後はアカウントごとの実測（基準値・出そろう日数・margin）で調整する */
export const PLATFORM_PROFILES: Record<string, PlatformProfile> = {
  // 表示の大半が 48 時間以内。リポスト・引用で広がる
  x: { weights: { reach: 0.35, engagement: 0.2, spread: 0.25, follow: 0.2 }, settleDays: 2 },
  // 返信（会話）で広がりやすい。リポストの比重は小さい
  threads: { weights: { reach: 0.35, engagement: 0.3, spread: 0.1, follow: 0.25 }, settleDays: 2 },
  bluesky: { weights: { reach: 0.3, engagement: 0.25, spread: 0.25, follow: 0.2 }, settleDays: 2 },
  instagram: { weights: { reach: 0.3, engagement: 0.3, spread: 0.15, follow: 0.25 }, settleDays: 3 },
  // おすすめ面での再生が中心。数日かけて伸びる
  tiktok: { weights: { reach: 0.45, engagement: 0.2, spread: 0.2, follow: 0.15 }, settleDays: 5 },
  // 検索・関連動画で長く伸びる。登録者の増加を重く見る
  youtube: { weights: { reach: 0.45, engagement: 0.15, spread: 0.1, follow: 0.3 }, settleDays: 7 },
  // PV とスキ。拡散の指標はほぼ取れない
  note: { weights: { reach: 0.4, engagement: 0.4, spread: 0.05, follow: 0.15 }, settleDays: 7 },
};
const DEFAULT_PROFILE: PlatformProfile = { weights: { reach: 0.35, engagement: 0.25, spread: 0.2, follow: 0.2 }, settleDays: 3 };
export const profileOf = (platform: string): PlatformProfile => PLATFORM_PROFILES[platform] ?? DEFAULT_PROFILE;

// --- 入力と集計（プログラム） -------------------------------------------------------------------

export const GROWTH_RULES = {
  /** 集計の期間 */
  windowDays: 28,
  /** 基準値の指数移動平均の係数（新しい評価の重み） */
  baselineAlpha: 0.3,
  /** margin の追従の係数 */
  marginAlpha: 0.3,
  /** 「良い投稿」にする割合の目安（スコアの上位） */
  successShare: 0.4,
  /** トピックの成績を評価ごとに残す割合（忘却） */
  armDecay: 0.9,
  /** 探索の温度の範囲 */
  temperature: { min: 0.5, max: 2 },
  /** 指標が出そろったとみなす割合（時点の表示回数 / 最終の表示回数） */
  settleShare: 0.85,
  /** 見逃したくない変化幅（対数比。log2(1.15) ≒ 15%） */
  detectDelta: Math.log2(1.15),
  /** 投稿スコアのばらつきの初期値（学習するまで） */
  defaultSigma: 0.45,
  /** 必要件数の範囲 */
  requiredPosts: { min: 5, max: 60 },
  /** 件数が足りなくても比べる上限の日数 */
  maxCompareDays: 28,
  /** 間隔の倍率（Jev の判定で上下）の範囲 */
  pace: { min: 0.5, max: 2 },
  /** 評価の間隔（worker からの実行） */
  evaluateEveryHours: 20,
  historyMax: 60,
};

export interface GrowthPost {
  id: string;
  publishedAt: Date;
  /** 指標を最後に取った時刻 */
  observedAt: Date | null;
  views: number | null;
  engagements: number | null;
  /** リポスト・引用・シェアの合計 */
  spreads: number | null;
  topic?: string;
  /** 公開から h 時間の時点の表示回数（出そろう日数の学習用） */
  checkpoints?: { h: number; views: number | null }[];
}

export interface GrowthInput {
  platform: string;
  /** 今のフォロワー数（取れない媒体は null） */
  followers: number | null;
  /** 期間の始めのフォロワー数（記録が無ければ null） */
  followersAtStart: number | null;
  /** 期間中の閲覧数（日次の記録の合計。無ければ投稿の表示回数の合計を使う） */
  periodViews: number | null;
  posts: GrowthPost[];
}

export interface GrowthMetrics {
  posts: number;
  medianViews: number | null;
  followers: number | null;
  engagementRate: number | null;
  followRate: number | null;
  spreadRate: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return s[i];
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 指標のある投稿（表示回数が取れたもの） */
const measured = (posts: GrowthPost[]) => posts.filter((p): p is GrowthPost & { views: number } => typeof p.views === "number" && p.views >= 0);

export function computeMetrics(input: GrowthInput): GrowthMetrics {
  const ps = measured(input.posts);
  const views = ps.reduce((s, p) => s + p.views, 0);
  const eng = ps.filter((p) => typeof p.engagements === "number");
  const spr = ps.filter((p) => typeof p.spreads === "number");
  const engViews = eng.reduce((s, p) => s + p.views, 0);
  const sprViews = spr.reduce((s, p) => s + p.views, 0);
  const periodViews = input.periodViews && input.periodViews > 0 ? input.periodViews : views;
  const gained = input.followers !== null && input.followersAtStart !== null ? input.followers - input.followersAtStart : null;
  return {
    posts: ps.length,
    medianViews: median(ps.map((p) => p.views)),
    followers: input.followers,
    engagementRate: engViews > 0 ? eng.reduce((s, p) => s + (p.engagements ?? 0), 0) / engViews : null,
    followRate: gained !== null && periodViews > 0 ? Math.max(0, gained) / periodViews : null,
    spreadRate: sprViews > 0 ? spr.reduce((s, p) => s + (p.spreads ?? 0), 0) / sprViews : null,
  };
}

// --- 状態 ------------------------------------------------------------------------------------

export interface GrowthTuning {
  /** このアカウントの「ふつう」（指数移動平均） */
  baselineViews: number | null;
  baselineRate: number | null;
  baselineSpread: number | null;
  /** 良い投稿の基準（投稿のスコアがこれを超えたら成功） */
  margin: number;
  /** 指標が出そろう日数（学習値。null なら媒体の初期値） */
  settleDays: number | null;
  /** 探索の温度（停滞・下降で上がり、伸びると下がる） */
  temperature: number;
  /** 停滞・下降が続いた評価の回数 */
  stagnation: number;
  /** 伸びの指数移動平均 */
  momentum: number;
  /**
   * 前回の比較: 比べた時刻・そのときのまとまりの上限（公開日時）・まとまりの指標・フォロワー数・連続の様子見回数
   */
  ref: { at: string; cutoff: string; batch: BatchMetrics | null; followers: number | null; holds: number } | null;
  /** 直近の判定（次に比べるまで引き継ぐ） */
  trend: GrowthTrend;
  delta: number | null;
  /** 投稿スコアのばらつき（指数移動平均） */
  sigma: number | null;
  /** 必要件数の倍率（Jev の「速める・遅らせる」で上下。1 = そのまま） */
  paceFactor: number;
  /** トピック変更などを適用した時刻（これより後の投稿だけで次を比べる） */
  changeAt: string | null;
  /** 直近の Jev の判定 */
  review: (GrowthReview & { at: string; applied: boolean; reason: string }) | null;
  /** トピックの成績に数えた投稿の公開日時の上限（二重に数えない） */
  countedUntil: string | null;
  evaluations: number;
}

export const INITIAL_TUNING: GrowthTuning = {
  baselineViews: null,
  baselineRate: null,
  baselineSpread: null,
  margin: 0,
  settleDays: null,
  temperature: 1,
  stagnation: 0,
  momentum: 0,
  ref: null,
  trend: "new",
  delta: null,
  sigma: null,
  paceFactor: 1,
  changeAt: null,
  review: null,
  countedUntil: null,
  evaluations: 0,
};

export type Arms = Record<string, { a: number; b: number }>;

export type GrowthTrend = "up" | "flat" | "down" | "hold" | "new";

/** まとまり（比べる単位の投稿群）の指標 */
export interface BatchMetrics {
  posts: number;
  medianViews: number | null;
  engagementRate: number | null;
  spreadRate: number | null;
  followRate: number | null;
}

/** Jev の判定（比べるときだけ） */
export interface GrowthReview {
  assessment: "real_growth" | "real_decline" | "noise" | "anomaly";
  pace: "faster" | "keep" | "slower" | "hold";
  mode: "shadow" | "gate";
  eventId?: string;
}

/** 次に比べるまでの時計 */
export interface GrowthClock {
  /** 判断に必要な件数 */
  requiredPosts: number;
  /** 前回の比較（または変更の適用）の後に出そろった投稿の件数 */
  collected: number;
  /** 1 日あたりの投稿数（直近 28 日） */
  postsPerDay: number;
  /** 必要件数がたまるまでの目安（日。投稿が無ければ null） */
  etaDays: number | null;
  /** 比べてよい最短の時刻（出そろう日数 + 1 日） */
  earliestAt: string | null;
  /** 件数が足りなくても比べる時刻 */
  latestAt: string | null;
  due: boolean;
  /** 件数が足りないまま（上限の日数で）比べる */
  lowConfidence: boolean;
  /** 変更の適用後の観測中 */
  observingChange: boolean;
}

export interface LoopParams {
  /** 改善処理の間隔（日・この範囲でランダム） */
  intervalDays: [number, number];
  /** 比較に使う投稿の最低表示回数 */
  minViews: number;
  /** 公開から指標を見るまでの日数 */
  minObservedDays: number;
  /** 1 グループの最低件数 */
  minGroupPosts: number;
  /** トピック選びで、成績にかかわらず試す割合 */
  exploration: number;
  /** 改善案の自動適用を許すか（初期は人の確認を挟む） */
  allowAutoApply: boolean;
  /** このレベルでの重み（初期ほど到達・フォローを重く見る） */
  weights: GrowthWeights;
}

export interface GrowthPhase {
  platform: string;
  metrics: GrowthMetrics;
  bands: Partial<Record<GrowthMetric, number>>;
  labels: Partial<Record<GrowthMetric, string>>;
  /** 到達レベル（0〜10） */
  level: number;
  stage: GrowthStage;
  params: LoopParams;
  trend: GrowthTrend;
  /** 前回のまとまりからの伸び（重み付きの対数比） */
  delta: number | null;
  /** 伸びとみなす幅（ノイズ） */
  tolerance: number;
  clock: GrowthClock;
  sigma: number;
  paceFactor: number;
  review: GrowthTuning["review"];
}

export type GrowthStage = "seed" | "sprout" | "growth" | "established" | "scale";
export const GROWTH_STAGE_LABEL: Record<GrowthStage, string> = { seed: "立ち上げ", sprout: "芽生え", growth: "成長", established: "定着", scale: "拡大" };
export const stageOf = (level: number): GrowthStage => (level < 1.5 ? "seed" : level < 3 ? "sprout" : level < 6 ? "growth" : level < 8.5 ? "established" : "scale");

/** 到達レベル: 表示回数とフォロワー数の帯の位置の平均（片方しか無ければその値） */
export function levelOf(m: GrowthMetrics): number {
  const xs: number[] = [];
  if (m.medianViews !== null) xs.push(bandPosition(m.medianViews, GROWTH_BANDS.views));
  if (m.followers !== null) xs.push(bandPosition(m.followers, GROWTH_BANDS.followers));
  return xs.length ? Number((xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(2)) : 0;
}

/** 判断に必要な件数: n = (1.64 × σ / δ)² × 倍率 */
export function requiredPosts(t: Pick<GrowthTuning, "sigma" | "paceFactor">): number {
  const R = GROWTH_RULES;
  const sigma = t.sigma ?? R.defaultSigma;
  return clamp(Math.ceil((((1.64 * sigma) / R.detectDelta) ** 2) * (t.paceFactor || 1)), R.requiredPosts.min, R.requiredPosts.max);
}

/**
 * レベルと学習値から、改善ループの設定値を決める。
 * postsPerDay があれば、改善処理の間隔は「必要件数がたまる日数」から決める（投稿が多いほど短い）。無ければレベルから
 */
export function loopParams(platform: string, level: number, t: GrowthTuning, postsPerDay = 0): LoopParams {
  const p = profileOf(platform);
  const k = clamp(level / 6, 0, 1); // 0 = 立ち上げ … 1 = 定着以上
  const w = p.weights;
  // 初期ほど「届くこと」「フォローされること」を重く見る。反応率は母数が小さいうちはぶれやすい
  const raw = { reach: w.reach * (1.5 - 0.5 * k), engagement: w.engagement * (0.6 + 0.4 * k), spread: w.spread * (0.8 + 0.2 * k), follow: w.follow * (1.4 - 0.4 * k) };
  const sum = raw.reach + raw.engagement + raw.spread + raw.follow;
  const weights = { reach: raw.reach / sum, engagement: raw.engagement / sum, spread: raw.spread / sum, follow: raw.follow / sum };
  const settle = clamp(t.settleDays ?? p.settleDays, 1, 7);
  let intervalDays: [number, number] = [Math.round(5 + 9 * k), Math.round(9 + 18 * k)];
  if (postsPerDay > 0) {
    const days = Math.max(requiredPosts(t) / postsPerDay, settle + 1);
    const lo = clamp(Math.round(days), 5, 21);
    intervalDays = [lo, clamp(Math.round(days * 1.6), lo + 2, 27)];
  }
  return {
    intervalDays,
    // 自分の「ふつう」の 3 割に届かない投稿は、配信されなかったとみなして比較に使わない
    minViews: Math.max(5, Math.round(0.3 * (t.baselineViews ?? 0))),
    minObservedDays: settle,
    minGroupPosts: clamp(Math.round(3 + level / 3), 3, 6),
    exploration: Number(clamp((0.4 - 0.03 * level) * t.temperature, 0.05, 0.6).toFixed(3)),
    allowAutoApply: level >= 2 && t.evaluations >= 2,
    weights,
  };
}

const logRatio = (cur: number | null, prev: number | null, eps: number) => (cur === null || prev === null ? null : Math.log2((cur + eps) / (prev + eps)));

/** 重み付きの対数比（使える指標だけで重みを配り直す） */
function weighted(parts: [number | null, number][]): number | null {
  const ok = parts.filter((x): x is [number, number] => x[0] !== null && x[1] > 0);
  const w = ok.reduce((s, [, v]) => s + v, 0);
  return w > 0 ? ok.reduce((s, [d, v]) => s + d * v, 0) / w : null;
}

/** まとまりの指標。followersGained はまとまりの期間に増えたフォロワー（取れなければ null） */
export function batchMetrics(posts: GrowthPost[], followersGained: number | null = null): BatchMetrics {
  const m = computeMetrics({ platform: "", followers: null, followersAtStart: null, periodViews: null, posts });
  const views = measured(posts).reduce((s, p) => s + p.views, 0);
  return { posts: m.posts, medianViews: m.medianViews, engagementRate: m.engagementRate, spreadRate: m.spreadRate, followRate: followersGained !== null && views > 0 ? Math.max(0, followersGained) / views : null };
}

/** 前回のまとまりからの伸び */
export function batchDelta(cur: BatchMetrics, prev: BatchMetrics, w: GrowthWeights): number | null {
  return weighted([
    [logRatio(cur.medianViews, prev.medianViews, 1), w.reach],
    [logRatio(cur.engagementRate, prev.engagementRate, 0.002), w.engagement],
    [logRatio(cur.spreadRate, prev.spreadRate, 0.0005), w.spread],
    [logRatio(cur.followRate, prev.followRate, 0.0002), w.follow],
  ]);
}

/** 伸びとみなす幅: 2 つのまとまりの差の標準誤差 × 1.28（片側 80%）。最小 0.05 */
export function batchTolerance(sigma: number, n1: number, n2: number): number {
  return Number(Math.max(0.05, 1.28 * sigma * Math.sqrt(1 / Math.max(1, n1) + 1 / Math.max(1, n2))).toFixed(3));
}

/** 次に比べるまでの時計（純粋関数） */
export function growthClock(input: GrowthInput, t: GrowthTuning, now: Date, settleDays: number): GrowthClock & { batch: (GrowthPost & { views: number })[]; cutoff: Date } {
  const R = GROWTH_RULES;
  const n = requiredPosts(t);
  const postsPerDay = Number((input.posts.filter((p) => p.publishedAt.getTime() <= now.getTime()).length / R.windowDays).toFixed(2));
  const cutoff = new Date(now.getTime() - settleDays * DAY);
  if (!t.ref) return { requiredPosts: n, collected: 0, postsPerDay, etaDays: null, earliestAt: null, latestAt: null, due: false, lowConfidence: false, observingChange: false, batch: [], cutoff };
  const refAt = new Date(t.ref.at).getTime();
  const changeAt = t.changeAt ? new Date(t.changeAt).getTime() : -Infinity;
  const start = Math.max(new Date(t.ref.cutoff).getTime(), changeAt);
  const batch = measured(input.posts).filter((p) => p.publishedAt.getTime() > start && p.publishedAt.getTime() <= cutoff.getTime());
  const earliest = Math.max(refAt, changeAt) + (settleDays + 1) * DAY;
  const latest = Math.max(refAt, changeAt) + R.maxCompareDays * DAY;
  const enough = batch.length >= n;
  const due = now.getTime() >= earliest && (enough || (now.getTime() >= latest && batch.length >= 2));
  const remaining = Math.max(0, n - batch.length);
  return {
    requiredPosts: n,
    collected: batch.length,
    postsPerDay,
    // 残りの件数を投稿するまで + 出そろうまで
    etaDays: remaining === 0 ? 0 : postsPerDay > 0 ? Number((remaining / postsPerDay + settleDays).toFixed(1)) : null,
    earliestAt: new Date(earliest).toISOString(),
    latestAt: new Date(latest).toISOString(),
    due,
    lowConfidence: due && !enough,
    observingChange: changeAt > new Date(t.ref.cutoff).getTime(),
    batch,
    cutoff,
  };
}

/**
 * Jev の判定をどこまで反映するか（コードのポリシー）。shadow・判定なしなら反映しない。
 * gate: 外れ値・コードの判定と逆向き・「様子見」は、連続 1 回まで様子見（次のまとまりも足して比べ直す）。
 *       「変化なし」は停滞として扱う。間隔の倍率は 速める 0.75 倍・遅らせる 1.4 倍
 */
export function reviewPolicy(codeTrend: "up" | "flat" | "down", review: GrowthReview | null, holds: number): { trend: "up" | "flat" | "down" | "hold"; paceMul: number; applied: boolean; reason: string } {
  if (!review || review.mode !== "gate") return { trend: codeTrend, paceMul: 1, applied: false, reason: review ? "Jev は記録のみ（shadow）" : "" };
  const conflict = (review.assessment === "real_growth" && codeTrend === "down") || (review.assessment === "real_decline" && codeTrend === "up");
  const paceMul = review.pace === "faster" ? 0.75 : review.pace === "slower" ? 1.4 : 1;
  if ((review.assessment === "anomaly" || conflict || review.pace === "hold") && holds < 1) {
    const why = review.assessment === "anomaly" ? "一時的な外れ値" : conflict ? "数値の判定と向きが逆" : "様子見が妥当";
    return { trend: "hold", paceMul: 1, applied: true, reason: `Jev: ${why}と判断し、次のまとまりも足して比べ直します` };
  }
  if (review.assessment === "noise" && codeTrend !== "flat") return { trend: "flat", paceMul, applied: true, reason: "Jev: 通常のぶれの範囲と判断" };
  return { trend: codeTrend, paceMul, applied: paceMul !== 1, reason: paceMul !== 1 ? `Jev: 比べる間隔を${paceMul < 1 ? "速める" : "遅らせる"}` : "" };
}

/** 比べたときの内容（Jev に渡す・画面に出す） */
export interface GrowthComparison {
  previous: BatchMetrics | null;
  current: BatchMetrics;
  delta: number | null;
  tolerance: number;
  codeTrend: "up" | "flat" | "down";
  lowConfidence: boolean;
  requiredPosts: number;
  topPostShare: number;
  daysSinceLast: number;
  afterChange: boolean;
}

const TREND_LABEL: Record<GrowthTrend, string> = { up: "伸びている", flat: "停滞", down: "下降", hold: "様子見", new: "初回" };

/** 投稿のスコア（このアカウントの基準との対数比の重み付き和。0 = ふつう） */
export function postScore(p: GrowthPost, t: GrowthTuning, w: GrowthWeights): number | null {
  if (typeof p.views !== "number" || t.baselineViews === null) return null;
  const rate = typeof p.engagements === "number" && p.views > 0 ? p.engagements / p.views : null;
  const spread = typeof p.spreads === "number" && p.views > 0 ? p.spreads / p.views : null;
  return weighted([
    [logRatio(p.views, t.baselineViews, 1), w.reach],
    [logRatio(rate, t.baselineRate, 0.002), w.engagement],
    [logRatio(spread, t.baselineSpread, 0.0005), w.spread],
  ]);
}

/** 時点ごとの表示回数から、指標が出そろう日数を推定する（推定できなければ null） */
export function estimateSettleDays(posts: GrowthPost[], share = GROWTH_RULES.settleShare): number | null {
  const ratios = new Map<number, number[]>();
  for (const p of posts) {
    const cps = (p.checkpoints ?? []).filter((c): c is { h: number; views: number } => typeof c.views === "number");
    const final = Math.max(typeof p.views === "number" ? p.views : 0, ...cps.map((c) => c.views));
    if (final < 10 || cps.length < 2) continue;
    for (const c of cps) ratios.set(c.h, [...(ratios.get(c.h) ?? []), c.views / final]);
  }
  const hours = [...ratios.keys()].filter((h) => (ratios.get(h)?.length ?? 0) >= 3).sort((a, b) => a - b);
  const h = hours.find((x) => (median(ratios.get(x)!) ?? 0) >= share);
  return h === undefined ? null : clamp(Math.ceil(h / 24), 1, 7);
}

const ema = (prev: number | null, cur: number | null, a: number) => (cur === null ? prev : prev === null ? cur : prev * (1 - a) + cur * a);

/**
 * 1 回の評価: 帯・レベルを求め、学習値（基準値・ばらつき・margin・出そろう日数）とトピックの成績を更新する。
 * 時計が来ていれば前回のまとまりと比べて、伸び・停滞・下降に応じて探索の温度を変える（review は Jev の判定）。
 * 純粋関数（DB を使わない）。now 以前に出そろった投稿だけを成績・比較に使う
 */
export function evaluateGrowth(
  input: GrowthInput,
  state: { tuning: GrowthTuning; arms: Arms; prevBands?: Partial<Record<GrowthMetric, number>>; prevExploration?: number },
  now = new Date(),
  review: GrowthReview | null = null
): { phase: GrowthPhase; tuning: GrowthTuning; arms: Arms; changes: string[]; compared: boolean; comparison: GrowthComparison | null } {
  const R = GROWTH_RULES;
  const before: GrowthTuning = { ...INITIAL_TUNING, ...state.tuning };
  const t: GrowthTuning = { ...before };
  const metrics = computeMetrics(input);
  const level = levelOf(metrics);
  const params0 = loopParams(input.platform, level, t);

  // 帯（前回の帯から境界付近では動かさない）
  const bands: GrowthPhase["bands"] = {};
  const labels: GrowthPhase["labels"] = {};
  const values: Record<GrowthMetric, number | null> = { views: metrics.medianViews, followers: metrics.followers, engagementRate: metrics.engagementRate, followRate: metrics.followRate, spreadRate: metrics.spreadRate };
  const changes: string[] = [];
  for (const k of Object.keys(GROWTH_BANDS) as GrowthMetric[]) {
    const v = values[k];
    if (v === null) continue;
    bands[k] = bandOf(v, GROWTH_BANDS[k], state.prevBands?.[k]);
    labels[k] = bandLabel(k, bands[k]!);
    const prev = state.prevBands?.[k];
    if (prev !== undefined && prev !== bands[k]) changes.push(`${GROWTH_METRIC_LABEL[k]}の帯が ${bandLabel(k, prev)} → ${labels[k]} に${bands[k]! > prev ? "上がりました" : "下がりました"}`);
  }

  // 指標が出そろう日数（実測できたときだけ。前の値とならす）
  const settle = estimateSettleDays(input.posts);
  if (settle !== null) t.settleDays = t.settleDays === null ? settle : Math.round((t.settleDays + settle) / 2);
  const settleDays = t.settleDays ?? profileOf(input.platform).settleDays;

  // 基準値（自分の「ふつう」）
  t.baselineViews = ema(t.baselineViews, metrics.medianViews, R.baselineAlpha);
  t.baselineRate = ema(t.baselineRate, metrics.engagementRate, R.baselineAlpha);
  t.baselineSpread = ema(t.baselineSpread, metrics.spreadRate, R.baselineAlpha);

  // 出そろった投稿のスコア → ばらつき・margin・トピックの成績
  const cutoff = new Date(now.getTime() - settleDays * DAY);
  const settled = input.posts.filter((p) => p.publishedAt.getTime() <= cutoff.getTime());
  const scored = settled.map((p) => ({ p, s: postScore(p, t, params0.weights) })).filter((x): x is { p: GrowthPost; s: number } => x.s !== null);
  if (scored.length >= 5) {
    const mean = scored.reduce((a, x) => a + x.s, 0) / scored.length;
    const sd = Math.sqrt(scored.reduce((a, x) => a + (x.s - mean) ** 2, 0) / (scored.length - 1));
    t.sigma = Number(clamp(ema(t.sigma, sd, R.baselineAlpha)!, 0.15, 2).toFixed(4));
  }
  const target = quantile(scored.map((x) => x.s), 1 - R.successShare);
  if (target !== null && scored.length >= 3) t.margin = Number((t.margin * (1 - R.marginAlpha) + target * R.marginAlpha).toFixed(4));

  const arms: Arms = {};
  for (const [k, v] of Object.entries(state.arms ?? {})) arms[k] = { a: 1 + (v.a - 1) * R.armDecay, b: 1 + (v.b - 1) * R.armDecay };
  const since = t.countedUntil ? new Date(t.countedUntil).getTime() : -Infinity;
  for (const { p, s } of scored) {
    if (!p.topic || p.publishedAt.getTime() <= since) continue;
    const arm = (arms[p.topic] ??= { a: 1, b: 1 });
    if (s > t.margin) arm.a += 1;
    else arm.b += 1;
  }
  for (const v of Object.values(arms)) {
    v.a = Number(v.a.toFixed(3));
    v.b = Number(v.b.toFixed(3));
  }
  if (scored.length) t.countedUntil = new Date(Math.max(since === -Infinity ? 0 : since, ...scored.map((x) => x.p.publishedAt.getTime()))).toISOString();

  // 証拠の時計: 前回のまとまりと、その後に出そろった投稿のまとまりを比べる
  const sigma = t.sigma ?? R.defaultSigma;
  const clock = growthClock(input, t, now, settleDays);
  let tolerance = batchTolerance(sigma, clock.requiredPosts, clock.requiredPosts);
  let compared = false;
  let comparison: GrowthComparison | null = null;
  if (!t.ref) {
    // 初回: 直近に出そろった投稿（必要件数まで）を最初のまとまりにする
    const first = measured(settled).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, clock.requiredPosts);
    t.ref = { at: now.toISOString(), cutoff: cutoff.toISOString(), batch: first.length ? batchMetrics(first) : null, followers: input.followers, holds: 0 };
    t.trend = "new";
  } else if (clock.due) {
    compared = true;
    const gained = input.followers !== null && t.ref.followers !== null ? input.followers - t.ref.followers : null;
    const cur = batchMetrics(clock.batch, gained);
    const prev = t.ref.batch;
    const delta = prev ? batchDelta(cur, prev, params0.weights) : null;
    tolerance = batchTolerance(sigma, cur.posts, prev?.posts ?? cur.posts);
    const codeTrend: "up" | "flat" | "down" = delta === null ? "flat" : delta > tolerance ? "up" : delta < -tolerance ? "down" : "flat";
    const views = clock.batch.map((p) => p.views);
    const total = views.reduce((a, v) => a + v, 0);
    comparison = {
      previous: prev,
      current: cur,
      delta: delta === null ? null : Number(delta.toFixed(4)),
      tolerance,
      codeTrend,
      lowConfidence: clock.lowConfidence,
      requiredPosts: clock.requiredPosts,
      // いちばん伸びた 1 件が表示回数の何割を占めるか（外れ値の目安）
      topPostShare: total > 0 ? Number((Math.max(...views) / total).toFixed(3)) : 0,
      daysSinceLast: Number(((now.getTime() - new Date(t.ref.at).getTime()) / DAY).toFixed(1)),
      afterChange: clock.observingChange,
    };
    const policy = reviewPolicy(codeTrend, review, t.ref.holds);
    if (review) t.review = { ...review, at: now.toISOString(), applied: policy.applied, reason: policy.reason };
    const fmt = (d: number | null) => (d === null ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(2)}`);
    if (policy.trend === "hold") {
      // 様子見: 基準点は動かさず、次のまとまりも足して比べ直す
      t.ref = { ...t.ref, holds: t.ref.holds + 1 };
      t.trend = "hold";
      changes.push(`比較を見送り（${policy.reason}）`);
    } else {
      // 温度は比べるたびに少し 1 に戻してから動かす（ずっと停滞していても上限に張り付かない。停滞が続くと 1.6 前後で落ち着く）
      t.temperature = 1 + (t.temperature - 1) * 0.85;
      if (policy.trend === "up") {
        t.temperature -= 0.12;
        t.stagnation = 0;
      } else if (policy.trend === "down") {
        t.temperature += 0.15;
        t.stagnation++;
      } else if (!clock.lowConfidence) {
        // 件数不足のまま比べた停滞は「判断できなかった」だけなので、停滞に数えない
        t.stagnation++;
        if (t.stagnation >= 2) t.temperature += 0.1;
      }
      t.temperature = Number(clamp(t.temperature, R.temperature.min, R.temperature.max).toFixed(3));
      if (delta !== null) t.momentum = Number((t.momentum * 0.7 + delta * 0.3).toFixed(4));
      // 間隔の倍率: Jev（gate）の判定で上下。判定が無ければ少しずつ 1 に戻す
      const pf = policy.paceMul !== 1 ? t.paceFactor * policy.paceMul : 1 + (t.paceFactor - 1) * 0.9;
      t.paceFactor = Number(clamp(pf, R.pace.min, R.pace.max).toFixed(3));
      t.trend = policy.trend;
      t.delta = delta === null ? null : Number(delta.toFixed(4));
      t.ref = { at: now.toISOString(), cutoff: clock.cutoff.toISOString(), batch: cur, followers: input.followers, holds: 0 };
      changes.push(
        `${clock.lowConfidence ? "件数不足のまま上限の日数で" : ""}比較: ${TREND_LABEL[policy.trend]}（伸び ${fmt(delta)}、誤差 ±${tolerance}、新しい投稿 ${cur.posts} 件）${policy.reason ? `・${policy.reason}` : ""}`
      );
      const n2 = requiredPosts(t);
      if (n2 !== clock.requiredPosts) changes.push(`比べるのに必要な件数 ${clock.requiredPosts} → ${n2} 件`);
    }
  }

  t.evaluations++;
  const nextClock = growthClock(input, t, now, settleDays);
  const params = loopParams(input.platform, level, t, nextClock.postsPerDay);
  if (before.evaluations > 0) {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const prevExploration = state.prevExploration ?? loopParams(input.platform, level, before).exploration;
    if (Math.abs(params.exploration - prevExploration) >= 0.02 && before.temperature !== t.temperature)
      changes.push(`探索の割合 ${pct(prevExploration)} → ${pct(params.exploration)}（${t.trend === "up" ? "伸びているので、成績の良いトピックを多めに" : t.trend === "down" ? "下がっているので、新しいトピックを多めに" : "停滞しているので、新しいトピックを多めに"}）`);
    if (before.settleDays !== t.settleDays && t.settleDays !== null) changes.push(`指標が出そろう日数を実測から ${t.settleDays} 日に調整しました`);
  }
  const { batch: _b, cutoff: _c, ...clockView } = nextClock;
  return {
    phase: { platform: input.platform, metrics, bands, labels, level, stage: stageOf(level), params, trend: t.trend, delta: t.delta, tolerance, clock: clockView, sigma: Number(sigma.toFixed(3)), paceFactor: t.paceFactor, review: t.review },
    tuning: t,
    arms,
    changes,
    compared,
    comparison,
  };
}

// --- トピック選び -------------------------------------------------------------------------

/** 標準正規分布（Box–Muller） */
function normal(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** ガンマ分布（Marsaglia–Tsang） */
function gamma(k: number, rng: () => number): number {
  if (k < 1) return gamma(k + 1, rng) * Math.pow(Math.max(1e-12, rng()), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(Math.max(1e-12, u)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rng: () => number = Math.random): number {
  const x = gamma(a, rng);
  const y = gamma(b, rng);
  return x / (x + y);
}

/**
 * 次に使うトピック。exploration の割合で「まだ試していない・試した回数が少ない」トピックを選び（探索）、
 * それ以外はトピックごとの成績からトンプソンサンプリングで選ぶ（活用）。
 */
export function chooseTopic(topics: string[], arms: Arms, exploration: number, rng: () => number = Math.random, rotation = 0): { topic: string; explored: boolean } {
  if (topics.length <= 1) return { topic: topics[0], explored: false };
  const tries = (t: string) => (arms[t] ? arms[t].a + arms[t].b - 2 : 0);
  if (rng() < exploration) {
    const min = Math.min(...topics.map(tries));
    const least = topics.filter((t) => tries(t) <= min + 0.5);
    return { topic: least[rotation % least.length], explored: true };
  }
  let best = topics[0];
  let bestV = -1;
  for (const t of topics) {
    const v = sampleBeta(arms[t]?.a ?? 1, arms[t]?.b ?? 1, rng);
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return { topic: best, explored: false };
}

/** 成績の見込み（ベータ分布の平均）と試行回数 */
export const armView = (arms: Arms) =>
  Object.entries(arms)
    .map(([topic, { a, b }]) => ({ topic, winRate: Number((a / (a + b)).toFixed(3)), tries: Number((a + b - 2).toFixed(1)) }))
    .sort((x, y) => y.winRate - x.winRate);

// --- DB ------------------------------------------------------------------------------------

/** アカウントの評価に使う投稿・フォロワー・閲覧数を読み込む */
async function loadInput(accountId: string, now: Date): Promise<GrowthInput> {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId } });
  const since = new Date(now.getTime() - GROWTH_RULES.windowDays * DAY);
  const rows = await prisma.content.findMany({
    where: { snsAccountId: accountId, status: "PUBLISHED", publishedAt: { gte: since, lte: now } },
    select: { id: true, publishedAt: true, engagement: true, metadata: true, metricSnapshots: { select: { checkpoint: true, views: true } } },
  });
  const posts: GrowthPost[] = rows.map((c) => {
    const e = (c.engagement ?? {}) as Record<string, unknown>;
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof e[k] === "number" ? (e[k] as number) : null);
    const spreads = ["reposts", "quotes", "shares"].map(n).filter((x): x is number => x !== null);
    return {
      id: c.id,
      publishedAt: c.publishedAt!,
      observedAt: typeof e.fetchedAt === "string" ? new Date(e.fetchedAt) : null,
      views: n("views"),
      engagements: n("engagements"),
      spreads: spreads.length ? spreads.reduce((s, v) => s + v, 0) : null,
      topic: typeof meta.title === "string" && meta.title ? meta.title : undefined,
      checkpoints: c.metricSnapshots.map((s) => ({ h: s.checkpoint, views: s.views })),
    };
  });
  const snaps = await prisma.accountSnapshot.findMany({ where: { snsAccountId: accountId, date: { gte: since } }, orderBy: { date: "asc" }, select: { followers: true, views: true } });
  const firstFollowers = snaps.find((s) => s.followers !== null)?.followers ?? null;
  const viewDays = snaps.filter((s) => s.views !== null);
  return {
    platform: acc.platform,
    followers: acc.followerCount ?? [...snaps].reverse().find((s) => s.followers !== null)?.followers ?? null,
    followersAtStart: firstFollowers,
    periodViews: viewDays.length ? viewDays.reduce((s, x) => s + (x.views ?? 0), 0) : null,
    posts,
  };
}

export interface GrowthHistoryEntry {
  at: string;
  level: number;
  stage: GrowthStage;
  bands: GrowthPhase["bands"];
  trend: GrowthTrend;
  compared?: boolean;
  delta: number | null;
  exploration: number;
  temperature: number;
  margin: number;
  changes: string[];
}

/**
 * 比べるときだけ Jev に判定させる（キー無し・off なら null）。
 * 本物の変化か・一時的な外れ値か、比べる間隔をどうするか。反映するかはコードのポリシー（reviewPolicy）で決める
 */
async function reviewWithJev(avatarId: string, accountId: string, platform: string, phase: Pick<GrowthPhase, "level" | "stage">, c: GrowthComparison): Promise<GrowthReview | null> {
  const state = {
    platform: getPlatform(platform)?.name ?? platform,
    stage: GROWTH_STAGE_LABEL[phase.stage],
    level: phase.level,
    previousBatch: c.previous,
    currentBatch: c.current,
    weightedLogChange: c.delta,
    noiseTolerance: c.tolerance,
    codeJudgement: c.codeTrend,
    requiredPostsForConfidence: c.requiredPosts,
    comparedWithFewerPostsThanRequired: c.lowConfidence,
    largestPostShareOfViews: c.topPostShare,
    daysSincePreviousComparison: c.daysSinceLast,
    firstComparisonAfterStrategyChange: c.afterChange,
  };
  const d = await decideWithJev(
    { decisionType: "growth", avatarId, subjectId: accountId },
    state,
    {
      assessment: choice("Comparing the current batch of posts with the previous batch, what best describes the change in this social media account's performance?", {
        real_growth: "A durable improvement across the batch, not explained by a single post.",
        real_decline: "A durable decline across the batch, not explained by a single post.",
        noise: "Within normal variation for this account; no meaningful change.",
        anomaly: "Driven by an outlier or a one-off event (a single viral post, holiday, platform-wide change), not a durable change.",
      }),
      pace: choice("How should the pace of the next evaluation change?", {
        faster: "The signal is clear and consistent; compare again with fewer posts.",
        keep: "Keep the current number of posts per comparison.",
        slower: "The signal is noisy; wait for more posts before the next comparison.",
        hold: "Do not act on this comparison yet; wait one more batch.",
      }),
    },
    (a) => {
      const top = topChoice(a.assessment);
      return { action: `${a.assessment.choice}/${a.pace.choice}`, confidence: top.confidence };
    }
  );
  return d ? { assessment: d.answers.assessment.choice, pace: d.answers.pace.choice, mode: d.mode, eventId: d.eventId } : null;
}

/** アカウントを評価して保存する。比べる時期なら Jev にも判定させる。帯・探索の割合などが変わったら活動ログに残す */
export async function evaluateAccountGrowth(accountId: string, now = new Date()) {
  const input = await loadInput(accountId, now);
  const row = await prisma.growthState.findUnique({ where: { snsAccountId: accountId } });
  const prevPhase = (row?.phase ?? {}) as Partial<GrowthPhase>;
  const state = { tuning: (row?.tuning ?? {}) as unknown as GrowthTuning, arms: (row?.arms ?? {}) as unknown as Arms, prevBands: prevPhase.bands, prevExploration: prevPhase.params?.exploration };
  let r = evaluateGrowth(input, state, now);
  if (r.comparison) {
    const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId }, select: { avatarId: true } });
    const review = await reviewWithJev(acc.avatarId, accountId, input.platform, r.phase, r.comparison);
    if (review) {
      r = evaluateGrowth(input, state, now, review);
      if (r.tuning.review?.applied && review.eventId) await markApplied(review.eventId);
    }
  }
  const entry: GrowthHistoryEntry = {
    at: now.toISOString(),
    level: r.phase.level,
    stage: r.phase.stage,
    bands: r.phase.bands,
    trend: r.phase.trend,
    compared: r.compared,
    delta: r.phase.delta,
    exploration: r.phase.params.exploration,
    temperature: r.tuning.temperature,
    margin: r.tuning.margin,
    changes: r.changes,
  };
  const history = [entry, ...(((row?.history ?? []) as unknown as GrowthHistoryEntry[]) ?? [])].slice(0, GROWTH_RULES.historyMax);
  const data = { phase: r.phase as object, tuning: r.tuning as object, arms: r.arms as object, history: history as object, evaluatedAt: now };
  await prisma.growthState.upsert({ where: { snsAccountId: accountId }, create: { snsAccountId: accountId, ...data }, update: data });
  if (r.changes.length || (prevPhase.stage && prevPhase.stage !== r.phase.stage)) {
    const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId }, select: { avatarId: true, accountName: true, platform: true } });
    const stage = prevPhase.stage && prevPhase.stage !== r.phase.stage ? [`段階が「${GROWTH_STAGE_LABEL[prevPhase.stage]}」→「${GROWTH_STAGE_LABEL[r.phase.stage]}」になりました`] : [];
    await prisma.activityLog.create({
      data: {
        avatarId: acc.avatarId,
        action: "growth_adjusted",
        category: "content",
        level: "info",
        description: `成長アルゴリズム（${getPlatform(acc.platform)?.name ?? acc.platform} ${acc.accountName}）: ${[...stage, ...r.changes].join(" / ")}`.slice(0, 1000),
        metadata: { accountId },
      },
    });
  }
  return r;
}

/**
 * トピック・追加の指示の変更や学びの追加を適用したことを記録する。
 * 以後、変更後の投稿が必要件数たまるまで比べない（変更の効果を、変更前と混ぜずに判定する）
 */
export async function markGrowthChange(accountIds: string[], at = new Date()) {
  for (const id of accountIds) {
    const row = await prisma.growthState.findUnique({ where: { snsAccountId: id } });
    if (!row) continue;
    await prisma.growthState.update({ where: { snsAccountId: id }, data: { tuning: { ...((row.tuning ?? {}) as object), changeAt: at.toISOString() } } });
  }
}

/** 評価の時期が来たアカウントを評価する（worker から定期実行）。投稿のあるアカウントだけ */
export async function processGrowth(now = new Date(), limit = 10): Promise<number> {
  const stale = new Date(now.getTime() - GROWTH_RULES.evaluateEveryHours * 3600_000);
  const accounts = await prisma.snsAccount.findMany({
    where: {
      isActive: true,
      avatar: { status: "ACTIVE" },
      contents: { some: { status: "PUBLISHED" } },
      OR: [{ growthState: null }, { growthState: { OR: [{ evaluatedAt: null }, { evaluatedAt: { lt: stale } }] } }],
    },
    select: { id: true },
    take: limit,
  });
  let n = 0;
  for (const a of accounts) {
    try {
      await evaluateAccountGrowth(a.id, now);
      n++;
    } catch (e) {
      console.warn(`[growth] ${a.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return n;
}

/** アカウントの最新の成長フェーズ（未評価なら null） */
export async function growthOf(accountId: string): Promise<{ phase: GrowthPhase; tuning: GrowthTuning; arms: Arms } | null> {
  const row = await prisma.growthState.findUnique({ where: { snsAccountId: accountId } });
  if (!row || !row.evaluatedAt) return null;
  return { phase: row.phase as unknown as GrowthPhase, tuning: { ...INITIAL_TUNING, ...(row.tuning as object) } as GrowthTuning, arms: (row.arms ?? {}) as Arms };
}

/** アバターの媒体ごとのループ設定（同じ媒体に複数のアカウントがあれば、慎重な方＝小さいレベルの設定） */
export async function growthParamsForAvatar(avatarId: string): Promise<Record<string, LoopParams & { level: number; stage: GrowthStage }>> {
  const rows = await prisma.growthState.findMany({ where: { snsAccount: { avatarId, isActive: true }, evaluatedAt: { not: null } }, include: { snsAccount: { select: { platform: true } } } });
  const out: Record<string, LoopParams & { level: number; stage: GrowthStage }> = {};
  for (const r of rows) {
    const ph = r.phase as unknown as GrowthPhase;
    if (!ph?.params) continue;
    const cur = out[r.snsAccount.platform];
    if (!cur || ph.level < cur.level) out[r.snsAccount.platform] = { ...ph.params, level: ph.level, stage: ph.stage };
  }
  return out;
}

/** 複数アカウントの成績をまとめる（自動化ルールが複数のアカウントに投稿する場合） */
export function mergeArms(list: Arms[]): Arms {
  const out: Arms = {};
  for (const arms of list) for (const [k, v] of Object.entries(arms)) {
    const o = (out[k] ??= { a: 1, b: 1 });
    o.a += v.a - 1;
    o.b += v.b - 1;
  }
  return out;
}

/** 画面表示用: アバターの各アカウントの成長フェーズ */
export async function avatarGrowthView(avatarId: string) {
  const accounts = await prisma.snsAccount.findMany({ where: { avatarId }, orderBy: { createdAt: "asc" }, include: { growthState: true } });
  return accounts.map((a) => {
    const g = a.growthState;
    return {
      accountId: a.id,
      platform: a.platform,
      platformName: getPlatform(a.platform)?.name ?? a.platform,
      accountName: a.accountName,
      isActive: a.isActive,
      evaluatedAt: g?.evaluatedAt ?? null,
      phase: (g?.evaluatedAt ? g.phase : null) as unknown as GrowthPhase | null,
      tuning: g?.evaluatedAt ? ({ ...INITIAL_TUNING, ...(g.tuning as object) } as GrowthTuning) : null,
      arms: g ? armView((g.arms ?? {}) as Arms).slice(0, 20) : [],
      history: ((g?.history ?? []) as unknown as GrowthHistoryEntry[]).slice(0, 20),
      profile: profileOf(a.platform),
    };
  });
}
