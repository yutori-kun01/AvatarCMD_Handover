// ================================================
// 指標の日別推移（ダッシュボード・アバター・アカウントで共通）
// ================================================
// 収益・投稿・失敗・フォロワー（数と前日比）・閲覧数・反応数・反応率を、指定期間と直前の同じ長さの期間について返す。
// 日付はすべて日本時間。フォロワー数は記録の無い日は直前の値を引き継ぐ（アカウントごとに計算してから合計する）。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { jstDay } from "./analytics";

const DAY = 24 * 3600_000;

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type Range = keyof typeof RANGES;
export const METRIC_KEYS = ["revenue", "followers", "views", "engagementRate", "posts"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface DayPoint {
  date: string;
  revenue: number;
  posts: number;
  failed: number;
  /** 記録のあるアカウントの合計（どのアカウントにも記録が無ければ null） */
  followers: number | null;
  /** 前日比（アカウントごとの差の合計。比較できない日は null） */
  followersDelta: number | null;
  views: number | null;
  engagements: number | null;
  /** engagements / views（閲覧数が無い日は null） */
  engagementRate: number | null;
}

export function parseRange(v: string | null | undefined): Range {
  if (!v) return "30d";
  if (v in RANGES) return v as Range;
  throw new ConfigError(`期間の指定が不正です: ${v}（7d / 30d / 90d）`);
}

/** 終わりの日を含む n 日分の日付（日本時間） */
export function lastDays(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => jstDay(new Date(now.getTime() - (n - 1 - i) * DAY)));
}

/**
 * アカウントごとのフォロワー記録 → 日別の合計と前日比。
 * 記録の無い日は直前の値を引き継ぐ。期間より前の最後の記録も引き継ぎの起点に使う。
 */
export function followerSeries(snaps: { accountId: string; date: string; followers: number | null }[], days: string[]): { followers: (number | null)[]; delta: (number | null)[] } {
  const byAccount = new Map<string, { date: string; followers: number }[]>();
  for (const s of snaps) {
    if (s.followers === null) continue;
    byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), { date: s.date, followers: s.followers }]);
  }
  const followers: (number | null)[] = days.map(() => null);
  const delta: (number | null)[] = days.map(() => null);
  for (const rows of byAccount.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    let j = 0;
    let cur: number | null = null;
    let prev: number | null = null;
    // 期間の前日までの最後の値
    while (j < rows.length && rows[j].date < days[0]) cur = rows[j++].followers;
    days.forEach((d, i) => {
      prev = cur;
      while (j < rows.length && rows[j].date <= d) cur = rows[j++].followers;
      if (cur === null) return;
      followers[i] = (followers[i] ?? 0) + cur;
      if (prev !== null) delta[i] = (delta[i] ?? 0) + (cur - prev);
    });
  }
  return { followers, delta };
}

const dateOnly = (day: string) => new Date(`${day}T00:00:00.000Z`);
const startOf = (day: string) => new Date(dateOnly(day).getTime() - 9 * 3600_000);

/** 期間（日付の配列）の日別の値 */
async function points(days: string[], where: { avatarId?: string; accountId?: string }): Promise<DayPoint[]> {
  const start = startOf(days[0]);
  const end = new Date(startOf(days.at(-1)!).getTime() + DAY);
  const contentWhere = { ...(where.avatarId ? { avatarId: where.avatarId } : {}), ...(where.accountId ? { snsAccountId: where.accountId } : {}) };
  const accountWhere = { ...(where.avatarId ? { avatarId: where.avatarId } : {}), ...(where.accountId ? { id: where.accountId } : {}) };
  const [published, failed, revenue, snaps, before] = await Promise.all([
    prisma.content.findMany({ where: { ...contentWhere, status: "PUBLISHED", publishedAt: { gte: start, lt: end } }, select: { publishedAt: true } }),
    prisma.content.findMany({ where: { ...contentWhere, status: "FAILED", updatedAt: { gte: start, lt: end } }, select: { updatedAt: true } }),
    prisma.revenue.findMany({ where: { ...contentWhere, status: { not: "refunded" }, earnedAt: { gte: start, lt: end } }, select: { earnedAt: true, amount: true } }),
    prisma.accountSnapshot.findMany({
      where: { snsAccount: accountWhere, date: { gte: dateOnly(days[0]), lte: dateOnly(days.at(-1)!) } },
      select: { snsAccountId: true, date: true, followers: true, views: true, engagements: true },
    }),
    // フォロワー数の引き継ぎの起点（期間の前の最後の記録。アカウントごと）
    prisma.accountSnapshot.findMany({
      where: { snsAccount: accountWhere, date: { lt: dateOnly(days[0]) }, followers: { not: null } },
      distinct: ["snsAccountId"],
      orderBy: [{ snsAccountId: "asc" }, { date: "desc" }],
      select: { snsAccountId: true, date: true, followers: true },
    }),
  ]);
  const idx = new Map(days.map((d, i) => [d, i]));
  const rows: DayPoint[] = days.map((date) => ({ date, revenue: 0, posts: 0, failed: 0, followers: null, followersDelta: null, views: null, engagements: null, engagementRate: null }));
  const at = (d: Date) => rows[idx.get(jstDay(d)) ?? -1];
  for (const p of published) at(p.publishedAt!) && at(p.publishedAt!).posts++;
  for (const p of failed) at(p.updatedAt) && at(p.updatedAt).failed++;
  for (const r of revenue) if (at(r.earnedAt)) at(r.earnedAt).revenue += r.amount;
  for (const s of snaps) {
    const row = rows[idx.get(s.date.toISOString().slice(0, 10)) ?? -1];
    if (!row) continue;
    if (s.views !== null) row.views = (row.views ?? 0) + s.views;
    if (s.engagements !== null) row.engagements = (row.engagements ?? 0) + s.engagements;
  }
  for (const r of rows) r.engagementRate = r.views ? (r.engagements ?? 0) / r.views : null;
  const f = followerSeries(
    [...before, ...snaps].map((s) => ({ accountId: s.snsAccountId, date: s.date.toISOString().slice(0, 10), followers: s.followers })),
    days
  );
  rows.forEach((r, i) => {
    r.followers = f.followers[i];
    r.followersDelta = f.delta[i];
  });
  return rows;
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
const hasAny = (xs: (number | null)[]) => xs.some((x) => x !== null);
/** 前期比（%）。比較できない場合は null */
export function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

function totals(rows: DayPoint[]) {
  const views = hasAny(rows.map((r) => r.views)) ? sum(rows.map((r) => r.views)) : null;
  const engagements = hasAny(rows.map((r) => r.engagements)) ? sum(rows.map((r) => r.engagements)) : null;
  const lastFollowers = [...rows].reverse().find((r) => r.followers !== null)?.followers ?? null;
  return {
    revenue: sum(rows.map((r) => r.revenue)),
    posts: sum(rows.map((r) => r.posts)),
    failed: sum(rows.map((r) => r.failed)),
    followers: lastFollowers,
    followersDelta: hasAny(rows.map((r) => r.followersDelta)) ? sum(rows.map((r) => r.followersDelta)) : null,
    views,
    engagements,
    engagementRate: views ? (engagements ?? 0) / views : null,
  };
}

/**
 * 指標の日別推移と、直前の同じ長さの期間との比較。
 * scope: avatarId を指定するとそのアバター、accountId を指定するとそのアカウントだけ。どちらも無ければ全体。
 */
export async function timeseries(opts: { range?: Range; avatarId?: string | null; accountId?: string | null; now?: Date } = {}) {
  const range = opts.range ?? "30d";
  const n = RANGES[range];
  const now = opts.now ?? new Date();
  const days = lastDays(n, now);
  const prevDays = lastDays(n, new Date(now.getTime() - n * DAY));
  const where = { avatarId: opts.avatarId ?? undefined, accountId: opts.accountId ?? undefined };
  const [cur, prev] = await Promise.all([points(days, where), points(prevDays, where)]);
  const t = totals(cur);
  const p = totals(prev);
  return {
    range,
    days,
    // 比較用: 前期間の同じ位置の日の値（prevXxx）
    daily: cur.map((r, i) => ({ ...r, prevRevenue: prev[i].revenue, prevViews: prev[i].views, prevPosts: prev[i].posts, prevEngagementRate: prev[i].engagementRate })),
    totals: t,
    prevTotals: p,
    change: {
      revenue: pctChange(t.revenue, p.revenue),
      posts: pctChange(t.posts, p.posts),
      views: pctChange(t.views, p.views),
      engagementRate: t.engagementRate !== null && p.engagementRate !== null ? Math.round((t.engagementRate - p.engagementRate) * 10000) / 100 : null,
      followersDelta: t.followersDelta !== null && p.followersDelta !== null ? t.followersDelta - p.followersDelta : null,
    },
  };
}
