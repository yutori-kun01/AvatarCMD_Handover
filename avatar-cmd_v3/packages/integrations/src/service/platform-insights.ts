// ================================================
// プラットフォーム × ジャンルの傾向（運用側のノウハウ） — 全アバターの投稿を横断して「どんな構成が伸びるか」を集計する
// ================================================
// ・アバター × プラットフォームごとに「普段」（表示回数・反応率の中央値）を決め、投稿ごとに自分比のスコアを出す。
//   → アバターの規模・ジャンルによる絶対値の差を消し、「そのアバターにとってどれだけ良かったか」だけを比べる。
// ・構成の値（post-features.ts）ごとに、アバターごとの中央値 → アバター間の中央値を傾向（lift）とする。
//   1 体の投稿が多くても結果を左右しないよう、アバター 1 体を 1 票として数える。
// ・3 体以上のアバターで集計できた値だけ保存する。数値だけを保存し、投稿の本文・アバター名は保存しない。
// ・この表は運用側のノウハウ。アバターのナレッジにはコピーせず、投稿を作るときにその場で読むだけにする
//   （エクスポート（export.ts）には含めない。設計書: Reports/platform_insights_and_export.md）。
// ・数値の抽出・集計はすべてプログラムで行い、AI は使わない（費用なし）。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getSetting, setSetting } from "./store";
import { profileOf } from "./growth";
import { median } from "./performance";
import { isGenre } from "./genre";
import { describeFeature, extractFeatures } from "./post-features";

const DAY = 86400_000;

export const INSIGHT_RULES = {
  /** 集計に使う投稿の期間 */
  windowDays: 90,
  /** アバター × プラットフォームの「普段」を決めるのに必要な投稿数 */
  minBaselinePosts: 8,
  /** アバターごとに、構成の値 1 つの集計に必要な投稿数 */
  minFeaturePosts: 3,
  /** 傾向として保存するのに必要なアバター数 */
  minAvatars: 3,
  /** 自分比の頭打ち（1 件のバズで傾向が決まらないように） */
  cap: 5,
  /** 集計の間隔 */
  everyHours: 24,
} as const;

/**
 * 投稿の生成に添える条件。
 * 添えるのは本文の書き方で決まる分類だけ。時間帯は本文では変えられず、リンクは AI に付けさせると存在しない URL を作るおそれがあるため添えない（画面には表示する）。
 */
export const PLAYBOOK_RULES = { minLift: 1.15, minAgree: 0.6, maxHints: 3, groups: ["hook", "length", "format", "hashtags"] as string[] } as const;

export const INSIGHT_SETTING_KEYS = {
  computedAt: "platform_insights_computed_at",
  /** off（既定）/ on: 傾向を投稿の生成に使う */
  playbookMode: "playbook_mode",
} as const;

/** 全ジャンルをまとめた集計の genre の値 */
export const ALL_GENRES = "all";
/** ラベルなしのアバター（運用側の自社アバターなど）をまとめて 1 クライアントと数えるときのキー */
const NO_CLIENT = "\u0000none";

export interface InsightRow {
  avatarId: string;
  genre: string | null;
  client: string | null;
  platform: string;
  text: string;
  publishedAt: Date;
  views: number;
  engagements: number;
}

export interface Insight {
  platform: string;
  genre: string;
  feature: string;
  lift: number;
  agree: number;
  avatars: number;
  clients: number;
  posts: number;
}

/** 集計（プログラム）。rows は指標が出そろった投稿だけを渡す */
export function computeInsights(rows: InsightRow[], rules: Pick<typeof INSIGHT_RULES, "minBaselinePosts" | "minFeaturePosts" | "minAvatars" | "cap"> = INSIGHT_RULES): Insight[] {
  // 1. アバター × プラットフォームの「普段」と、投稿ごとの自分比のスコア
  const byAp = new Map<string, InsightRow[]>();
  for (const r of rows) {
    if (!(r.views > 0) || !(r.engagements >= 0)) continue;
    const k = `${r.avatarId}|${r.platform}`;
    byAp.set(k, [...(byAp.get(k) ?? []), r]);
  }
  // avatarId|platform|feature → スコアの配列
  const perAvatar = new Map<string, { row: InsightRow; scores: number[] }>();
  for (const posts of byAp.values()) {
    if (posts.length < rules.minBaselinePosts) continue;
    const baseViews = median(posts.map((p) => p.views))!;
    const baseRate = median(posts.map((p) => p.engagements / p.views))!;
    if (!(baseViews > 0)) continue;
    for (const p of posts) {
      const viewsRel = Math.min(p.views / baseViews, rules.cap);
      // 普段の反応率が 0（反応がほとんど無いアカウント）のときは反応率では比べず、表示回数だけで比べる
      const score = baseRate > 0 ? (viewsRel + Math.min(p.engagements / p.views / baseRate, rules.cap)) / 2 : viewsRel;
      for (const f of extractFeatures({ platform: p.platform, text: p.text, publishedAt: p.publishedAt })) {
        const k = `${p.avatarId}|${p.platform}|${f}`;
        const cur = perAvatar.get(k) ?? { row: p, scores: [] };
        cur.scores.push(score);
        perAvatar.set(k, cur);
      }
    }
  }

  // 2. アバターごとの中央値を、プラットフォーム × ジャンル（と全ジャンル）× 構成でまとめる
  const groups = new Map<string, { platform: string; genre: string; feature: string; lifts: number[]; clients: Set<string>; posts: number }>();
  for (const [k, { row, scores }] of perAvatar) {
    if (scores.length < rules.minFeaturePosts) continue;
    const feature = k.split("|")[2];
    const avatarLift = median(scores)!;
    const genres = [ALL_GENRES, ...(row.genre && isGenre(row.genre) ? [row.genre] : [])];
    for (const genre of genres) {
      const gk = `${row.platform}|${genre}|${feature}`;
      const g = groups.get(gk) ?? { platform: row.platform, genre, feature, lifts: [], clients: new Set<string>(), posts: 0 };
      g.lifts.push(avatarLift);
      g.clients.add(row.client?.trim() || NO_CLIENT);
      g.posts += scores.length;
      groups.set(gk, g);
    }
  }

  const out: Insight[] = [];
  for (const g of groups.values()) {
    if (g.lifts.length < rules.minAvatars) continue;
    out.push({
      platform: g.platform,
      genre: g.genre,
      feature: g.feature,
      lift: Number(median(g.lifts)!.toFixed(3)),
      agree: Number((g.lifts.filter((x) => x > 1).length / g.lifts.length).toFixed(3)),
      avatars: g.lifts.length,
      clients: g.clients.size,
      posts: g.posts,
    });
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform) || a.genre.localeCompare(b.genre) || b.lift - a.lift);
}

/** 集計に使う投稿を読む（公開済み・期間内・指標が出そろってから取得したもの） */
export async function loadInsightRows(now = new Date()): Promise<InsightRow[]> {
  const contents = await prisma.content.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: new Date(now.getTime() - INSIGHT_RULES.windowDays * DAY) } },
    select: { avatarId: true, platform: true, content: true, publishedAt: true, engagement: true, avatar: { select: { genre: true, clientLabel: true } } },
  });
  const rows: InsightRow[] = [];
  for (const c of contents) {
    const e = (c.engagement ?? {}) as Record<string, unknown>;
    const views = typeof e.views === "number" ? e.views : null;
    const engagements = typeof e.engagements === "number" ? e.engagements : null;
    const fetchedAt = typeof e.fetchedAt === "string" ? new Date(e.fetchedAt) : null;
    if (views === null || engagements === null || !fetchedAt || !c.publishedAt) continue;
    // 指標が出そろう前の値は使わない（媒体ごとの日数は成長アルゴリズムの初期値）
    if (fetchedAt.getTime() - c.publishedAt.getTime() < profileOf(c.platform).settleDays * DAY) continue;
    rows.push({ avatarId: c.avatarId, genre: c.avatar.genre, client: c.avatar.clientLabel, platform: c.platform, text: c.content, publishedAt: c.publishedAt, views, engagements });
  }
  return rows;
}

/** 傾向を作り直す（全件を入れ替える。条件を満たさなくなった値は消える） */
export async function recomputePlatformInsights(now = new Date()): Promise<{ insights: number; posts: number }> {
  const rows = await loadInsightRows(now);
  const insights = computeInsights(rows);
  await prisma.$transaction([prisma.platformInsight.deleteMany({}), prisma.platformInsight.createMany({ data: insights.map((i) => ({ ...i, computedAt: now })) })]);
  await setSetting(INSIGHT_SETTING_KEYS.computedAt, now.toISOString());
  return { insights: insights.length, posts: rows.length };
}

/** worker から呼ぶ。前回の集計から everyHours たっていれば作り直す */
export async function processPlatformInsights(now = new Date()): Promise<number> {
  const last = await getSetting(INSIGHT_SETTING_KEYS.computedAt);
  if (last && now.getTime() - new Date(last).getTime() < INSIGHT_RULES.everyHours * 3600_000) return 0;
  return (await recomputePlatformInsights(now)).insights;
}

export async function listPlatformInsights(filter: { platform?: string; genre?: string } = {}) {
  const rows = await prisma.platformInsight.findMany({
    where: { ...(filter.platform ? { platform: filter.platform } : {}), ...(filter.genre ? { genre: filter.genre } : {}) },
    orderBy: [{ platform: "asc" }, { genre: "asc" }, { lift: "desc" }],
  });
  return rows.map((r) => ({ ...r, ...describeFeature(r.feature) }));
}

export type PlaybookMode = "off" | "on";

export async function getPlaybookMode(): Promise<PlaybookMode> {
  return (await getSetting(INSIGHT_SETTING_KEYS.playbookMode)) === "on" ? "on" : "off";
}

export async function setPlaybookMode(mode: string): Promise<void> {
  if (mode !== "on" && mode !== "off") throw new ConfigError("on か off を指定してください");
  await setSetting(INSIGHT_SETTING_KEYS.playbookMode, mode === "on" ? "on" : null);
}

export interface PlaybookHint {
  feature: string;
  text: string;
  lift: number;
  genre: string;
}

/**
 * 投稿の生成に添える傾向（設定がオンのときだけ）。そのアバターのジャンルの傾向を優先し、無い分類は全ジャンルで補う。
 * lift・agree が条件を満たすものを、分類ごとに 1 つ、最大 maxHints 個まで。
 */
export async function playbookHints(platform: string | undefined, genre: string | null | undefined): Promise<PlaybookHint[]> {
  if (!platform || (await getPlaybookMode()) !== "on") return [];
  const genres = [...(genre && isGenre(genre) ? [genre] : []), ALL_GENRES];
  const rows = await prisma.platformInsight.findMany({
    where: { platform, genre: { in: genres }, lift: { gte: PLAYBOOK_RULES.minLift }, agree: { gte: PLAYBOOK_RULES.minAgree } },
  });
  return pickHints(rows, genres);
}

/** 分類ごとに 1 つ（ジャンルの傾向を優先 → lift の大きい順）。テスト用に分けている */
export function pickHints(rows: { feature: string; lift: number; genre: string }[], genreOrder: string[]): PlaybookHint[] {
  const sorted = [...rows].sort((a, b) => genreOrder.indexOf(a.genre) - genreOrder.indexOf(b.genre) || b.lift - a.lift);
  const seen = new Set<string>();
  const out: PlaybookHint[] = [];
  for (const r of sorted) {
    const d = describeFeature(r.feature);
    if (!PLAYBOOK_RULES.groups.includes(d.group) || seen.has(d.group)) continue;
    seen.add(d.group);
    out.push({ feature: r.feature, text: d.label, lift: r.lift, genre: r.genre });
  }
  return out.sort((a, b) => b.lift - a.lift).slice(0, PLAYBOOK_RULES.maxHints);
}

/** プロンプトに添える文 */
export function formatPlaybookForPrompt(hints: PlaybookHint[]): string {
  if (!hints.length) return "";
  return [
    "参考: このプラットフォームで反応が良い構成の傾向（複数のアカウントの集計。口調・主張・事実は変えないこと。このアバターや今回のトピックに合わなければ無視してよい）:",
    ...hints.map((h) => `・${h.text}（普段の約${h.lift.toFixed(2)}倍）`),
  ].join("\n");
}
