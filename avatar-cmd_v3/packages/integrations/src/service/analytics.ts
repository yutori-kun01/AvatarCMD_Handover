// ================================================
// アカウント分析（バイタルチェック）と収益アイテム
// ================================================
// ・フォロワー数: fetchProfile に対応したプラットフォーム（X / Threads / Bluesky / YouTube）は worker が1日1回取得し、
//   AccountSnapshot に日次で記録する。非対応のプラットフォームは画面から手入力できる（同じく日次で記録）。
// ・収益アイテム: 繰り返し売れる記事・商品を単価付きで登録しておき、次からは「選んで日付と数量を入れるだけ」で記録する。
// ・月の区切りはすべて日本時間（Asia/Tokyo）。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getPlatform, PLATFORM_LIST } from "../platforms";
import type { ProfileStats } from "../types";
import { loadFreshCredentials } from "./accounts";
import { errorMessage } from "./publish";
import { getSystemConfig } from "./store";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** 日本時間（UTC+9、夏時間なし） */
const JST = 9 * HOUR;

// --- 月・日の計算（日本時間） ------------------------------------------------------

/** "YYYY-MM" を検証して返す。未指定なら今月 */
export function normalizeMonth(month: string | null | undefined, now = new Date()): string {
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  if (month) throw new ConfigError(`月の形式が不正です: ${month}（YYYY-MM）`);
  return jstDay(now).slice(0, 7);
}

/** 日本時間の日付 "YYYY-MM-DD" */
export function jstDay(d: Date): string {
  return new Date(d.getTime() + JST).toISOString().slice(0, 10);
}

/** 月の開始・終了（終了は翌月1日 0:00 JST） */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1) - JST), end: new Date(Date.UTC(y, m, 1) - JST) };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** 月の日付一覧（"YYYY-MM-DD"） */
export function monthDays(month: string): string[] {
  const { start, end } = monthRange(month);
  const out: string[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY) out.push(jstDay(new Date(t)));
  return out;
}

/** 日本時間の日付を DB の DATE 列に入れる値（UTC 0:00） */
function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

// --- フォロワー数 ------------------------------------------------------------------

/** 取得・入力した数値を保存し、今日（日本時間）の記録を更新する */
export async function saveProfileStats(accountId: string, s: ProfileStats, now = new Date()) {
  const clean = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
  const followers = clean(s.followers);
  const following = clean(s.following);
  const posts = clean(s.posts);
  await prisma.snsAccount.update({
    where: { id: accountId },
    data: {
      ...(followers !== undefined ? { followerCount: followers } : {}),
      ...(following !== undefined ? { followingCount: following } : {}),
      followersUpdatedAt: now,
      followersError: null,
    },
  });
  const date = dateOnly(jstDay(now));
  await prisma.accountSnapshot.upsert({
    where: { snsAccountId_date: { snsAccountId: accountId, date } },
    create: { snsAccountId: accountId, date, followers: followers ?? null, following: following ?? null, posts: posts ?? null },
    update: { ...(followers !== undefined ? { followers } : {}), ...(following !== undefined ? { following } : {}), ...(posts !== undefined ? { posts } : {}) },
  });
  return { followers, following, posts };
}

/** 1アカウントのフォロワー数を API から取得して保存する（失敗時は理由を保存して例外） */
export async function refreshFollowers(accountId: string, now = new Date()) {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId } });
  const def = getPlatform(acc.platform);
  if (!def?.fetchProfile) throw new ConfigError(`${def?.name ?? acc.platform} はフォロワー数の自動取得に対応していません（手入力してください）`);
  try {
    const { credentials, app } = await loadFreshCredentials(acc.id);
    const stats = await def.fetchProfile({
      app,
      credentials,
      settings: (acc.settings ?? {}) as Record<string, unknown>,
      account: { accountId: acc.accountId ?? "", accountName: acc.accountName },
      system: await getSystemConfig(),
    });
    return await saveProfileStats(acc.id, stats, now);
  } catch (e) {
    await prisma.snsAccount.update({ where: { id: acc.id }, data: { followersUpdatedAt: now, followersError: errorMessage(e).slice(0, 300) } });
    throw e;
  }
}

/** worker から: 前回から 20 時間以上たったアカウントのフォロワー数を取得する。取得できた件数を返す */
export async function collectFollowers({ maxAccounts = 5 } = {}): Promise<number> {
  const now = new Date();
  const supported: string[] = PLATFORM_LIST.filter((p) => !!p.fetchProfile).map((p) => p.id);
  const due = await prisma.snsAccount.findMany({
    where: {
      isActive: true,
      platform: { in: supported },
      OR: [{ followersUpdatedAt: null }, { followersUpdatedAt: { lt: new Date(now.getTime() - 20 * HOUR) } }],
    },
    orderBy: { followersUpdatedAt: { sort: "asc", nulls: "first" } },
    take: maxAccounts,
    select: { id: true },
  });
  let n = 0;
  for (const a of due) {
    try {
      await refreshFollowers(a.id, now);
      n++;
    } catch {
      // 理由は followersError に保存済み。次の間隔で再試行する
    }
  }
  return n;
}

// --- 収益アイテム ------------------------------------------------------------------

export interface RevenueItemInput {
  avatarId: string;
  snsAccountId?: string | null;
  name: string;
  source?: string;
  platform: string;
  unitPrice: number | string;
  url?: string | null;
  isActive?: boolean;
}

async function checkAccount(avatarId: string, snsAccountId?: string | null) {
  if (!snsAccountId) return null;
  const acc = await prisma.snsAccount.findUnique({ where: { id: snsAccountId } });
  if (!acc) throw new ConfigError("選択したアカウントが見つかりません");
  if (acc.avatarId !== avatarId) throw new ConfigError("選択したアカウントはこのアバターのものではありません");
  return acc;
}

function parsePrice(v: number | string, label = "単価"): number {
  const n = Number(String(v).replace(/[,，¥円\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new ConfigError(`${label}を正しく入力してください`);
  return n;
}

export async function saveRevenueItem(input: RevenueItemInput, id?: string) {
  if (!input.avatarId) throw new ConfigError("アバターを選択してください");
  if (!input.name?.trim()) throw new ConfigError("アイテム名を入力してください（例: 記事『朝の集中ルーティン』）");
  if (!input.platform?.trim()) throw new ConfigError("プラットフォームを入力してください");
  await checkAccount(input.avatarId, input.snsAccountId);
  const data = {
    avatarId: input.avatarId,
    snsAccountId: input.snsAccountId || null,
    name: input.name.trim(),
    source: input.source?.trim() || "paid_content",
    platform: input.platform.trim(),
    unitPrice: parsePrice(input.unitPrice),
    url: input.url?.trim() || null,
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  return id ? prisma.revenueItem.update({ where: { id }, data }) : prisma.revenueItem.create({ data });
}

export async function listRevenueItems() {
  const items = await prisma.revenueItem.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    include: { avatar: { select: { name: true } }, snsAccount: { select: { accountName: true, platform: true } } },
  });
  const stats = await prisma.revenue.groupBy({
    by: ["itemId"],
    where: { itemId: { in: items.map((i) => i.id) }, status: { not: "refunded" } },
    _sum: { amount: true, quantity: true },
    _max: { earnedAt: true },
  });
  const byId = new Map(stats.map((s) => [s.itemId, s]));
  return items.map((i) => ({
    id: i.id,
    avatarId: i.avatarId,
    avatarName: i.avatar.name,
    snsAccountId: i.snsAccountId,
    accountName: i.snsAccount ? `${getPlatform(i.snsAccount.platform)?.name ?? i.snsAccount.platform} ${i.snsAccount.accountName}` : null,
    name: i.name,
    source: i.source,
    platform: i.platform,
    unitPrice: i.unitPrice,
    url: i.url,
    isActive: i.isActive,
    total: byId.get(i.id)?._sum.amount ?? 0,
    quantity: byId.get(i.id)?._sum.quantity ?? 0,
    lastEarnedAt: byId.get(i.id)?._max.earnedAt ?? null,
  }));
}

export interface RevenueInput {
  itemId?: string | null;
  avatarId?: string;
  snsAccountId?: string | null;
  source?: string;
  platform?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  amount?: number | string;
  currency?: string;
  description?: string;
  earnedAt?: string | Date;
}

/**
 * 収益を記録する。アイテムを選んだ場合はアバター・アカウント・収益源・プラットフォームをアイテムから引き継ぎ、
 * 金額は「数量 × 単価」（amount を指定すればそちらを優先。値引き・手数料差し引きなど）。
 */
export async function recordRevenue(input: RevenueInput) {
  const item = input.itemId ? await prisma.revenueItem.findUnique({ where: { id: input.itemId } }) : null;
  if (input.itemId && !item) throw new ConfigError("選択したアイテムが見つかりません");
  const avatarId = item?.avatarId ?? input.avatarId;
  if (!avatarId) throw new ConfigError("アバターを選択してください");
  const snsAccountId = input.snsAccountId !== undefined ? input.snsAccountId || null : item?.snsAccountId ?? null;
  await checkAccount(avatarId, snsAccountId);
  const quantity = input.quantity === undefined || input.quantity === "" ? 1 : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) throw new ConfigError("数量は1以上の整数で入力してください");
  const unitPrice = input.unitPrice !== undefined && input.unitPrice !== "" ? parsePrice(input.unitPrice) : item?.unitPrice;
  const amount = input.amount !== undefined && input.amount !== "" ? Number(String(input.amount).replace(/[,，¥円\s]/g, "")) : unitPrice !== undefined ? unitPrice * quantity : NaN;
  if (!Number.isFinite(amount) || amount === 0) throw new ConfigError("金額を入力してください");
  const source = (input.source?.trim() || item?.source || "").trim();
  const platform = (input.platform?.trim() || item?.platform || "").trim();
  if (!source || !platform) throw new ConfigError("収益源とプラットフォームを入力してください");
  const earnedAt = input.earnedAt ? new Date(input.earnedAt) : new Date();
  if (Number.isNaN(earnedAt.getTime())) throw new ConfigError("日付が不正です");
  return prisma.revenue.create({
    data: {
      avatarId,
      snsAccountId,
      itemId: item?.id ?? null,
      quantity,
      source,
      platform,
      amount,
      currency: input.currency?.trim() || "JPY",
      description: input.description?.trim() || null,
      earnedAt,
    },
  });
}

// --- バイタルチェック -------------------------------------------------------------

export type VitalLevel = "good" | "warning" | "error" | "inactive";

/** 数値からアカウントの状態（0〜100 のスコアと理由）を決める。しきい値はここで管理する */
export function vitalCheck(v: {
  isActive: boolean;
  lastError: string | null;
  posts: number;
  failed: number;
  tokenExpiresInDays: number | null;
  followersDelta: number | null;
  revenue: number;
  prevRevenue: number;
  /** 表示している月が今月か（今月は「投稿なし」の判定を月初7日間は猶予する） */
  currentMonth: boolean;
  dayOfMonth: number;
}): { level: VitalLevel; score: number; reasons: string[] } {
  if (!v.isActive) return { level: "inactive", score: 0, reasons: ["停止中"] };
  let score = 100;
  const reasons: string[] = [];
  let level: VitalLevel = "good";
  const worse = (l: VitalLevel) => {
    if (l === "error" || (l === "warning" && level === "good")) level = l;
  };
  if (v.lastError) {
    score -= 40;
    reasons.push("接続・投稿エラーあり");
    worse("error");
  }
  if (v.failed > 0) {
    const rate = v.failed / (v.posts + v.failed);
    score -= Math.min(30, Math.round(rate * 60));
    reasons.push(`投稿失敗 ${v.failed}件（失敗率 ${Math.round(rate * 100)}%）`);
    worse(rate >= 0.5 ? "error" : "warning");
  }
  if (v.tokenExpiresInDays !== null && v.tokenExpiresInDays < 3) {
    score -= 15;
    reasons.push(v.tokenExpiresInDays < 0 ? "トークン期限切れ（再接続が必要）" : "トークンの期限が近い");
    worse(v.tokenExpiresInDays < 0 ? "error" : "warning");
  }
  if (v.posts === 0 && (!v.currentMonth || v.dayOfMonth > 7)) {
    score -= 15;
    reasons.push("この月の投稿なし");
    worse("warning");
  }
  if (v.followersDelta !== null && v.followersDelta < 0) {
    score -= 5;
    reasons.push(`フォロワー減少（${v.followersDelta}）`);
  }
  if (v.prevRevenue > 0 && v.revenue < v.prevRevenue * 0.5 && (!v.currentMonth || v.dayOfMonth > 20)) {
    score -= 5;
    reasons.push("収益が前月の半分未満");
  }
  return { level, score: Math.max(0, score), reasons };
}

/** 月のフォロワー増減: 月内の最後の記録 − 月初より前の最後の記録（無ければ月内の最初の記録） */
export function followersDelta(snaps: { date: string; followers: number | null }[], month: string): { start: number | null; end: number | null; delta: number | null } {
  const withValue = snaps.filter((s) => s.followers !== null).sort((a, b) => a.date.localeCompare(b.date));
  const before = withValue.filter((s) => s.date < `${month}-01`).at(-1);
  const inMonth = withValue.filter((s) => s.date.startsWith(month));
  const start = before?.followers ?? inMonth[0]?.followers ?? null;
  const end = inMonth.at(-1)?.followers ?? null;
  return { start, end, delta: start !== null && end !== null ? end - start : null };
}

/**
 * アカウントごとの月次の数値（投稿・エラー・収益・フォロワー・反応）と日別の推移。
 * avatarId を指定するとそのアバターのアカウントだけ。
 */
export async function accountVitals(opts: { month?: string | null; avatarId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const month = normalizeMonth(opts.month, now);
  const { start, end } = monthRange(month);
  const prev = monthRange(shiftMonth(month, -1));
  const trendStart = monthRange(shiftMonth(month, -5)).start;
  const days = monthDays(month);
  const currentMonth = month === jstDay(now).slice(0, 7);
  const dayOfMonth = Number(jstDay(now).slice(8, 10));
  const avatarFilter = opts.avatarId ? { avatarId: opts.avatarId } : {};

  const [accounts, published, failed, pending, drafts, revenues, snaps] = await Promise.all([
    prisma.snsAccount.findMany({ where: avatarFilter, orderBy: [{ avatarId: "asc" }, { createdAt: "asc" }], include: { avatar: { select: { name: true } } } }),
    prisma.content.findMany({
      where: { ...avatarFilter, status: "PUBLISHED", publishedAt: { gte: start, lt: end }, snsAccountId: { not: null } },
      select: { snsAccountId: true, publishedAt: true, engagement: true },
    }),
    prisma.content.findMany({
      where: { ...avatarFilter, status: "FAILED", updatedAt: { gte: start, lt: end }, snsAccountId: { not: null } },
      select: { snsAccountId: true, updatedAt: true },
    }),
    prisma.content.groupBy({ by: ["snsAccountId"], where: { ...avatarFilter, status: "SCHEDULED", snsAccountId: { not: null } }, _count: { _all: true } }),
    prisma.content.groupBy({ by: ["snsAccountId"], where: { ...avatarFilter, status: "DRAFT", snsAccountId: { not: null } }, _count: { _all: true } }),
    prisma.revenue.findMany({
      where: { ...avatarFilter, status: { not: "refunded" }, earnedAt: { gte: trendStart, lt: end } },
      select: { snsAccountId: true, avatarId: true, amount: true, quantity: true, earnedAt: true, itemId: true, item: { select: { name: true } }, description: true, platform: true },
    }),
    prisma.accountSnapshot.findMany({
      where: { snsAccount: avatarFilter, date: { gte: dateOnly(jstDay(prev.start)), lt: dateOnly(jstDay(end)) } },
      select: { snsAccountId: true, date: true, followers: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const trendMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const count = (rows: { snsAccountId: string | null; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.snsAccountId, r._count._all]));
  const pendingBy = count(pending);
  const draftBy = count(drafts);

  const rows = accounts.map((a) => {
    const def = getPlatform(a.platform);
    const myPosts = published.filter((p) => p.snsAccountId === a.id);
    const myFailed = failed.filter((p) => p.snsAccountId === a.id);
    const myRevenue = revenues.filter((r) => r.snsAccountId === a.id);
    const inMonth = myRevenue.filter((r) => r.earnedAt >= start && r.earnedAt < end);
    const revenue = inMonth.reduce((s, r) => s + r.amount, 0);
    const prevRevenue = myRevenue.filter((r) => r.earnedAt >= prev.start && r.earnedAt < prev.end).reduce((s, r) => s + r.amount, 0);
    const mySnaps = snaps.filter((s) => s.snsAccountId === a.id).map((s) => ({ date: s.date.toISOString().slice(0, 10), followers: s.followers }));
    const f = followersDelta(mySnaps, month);

    let views = 0;
    let engagements = 0;
    const rates: number[] = [];
    for (const p of myPosts) {
      const e = (p.engagement ?? {}) as { views?: number; engagements?: number; engagementRate?: number | null };
      views += e.views ?? 0;
      engagements += e.engagements ?? 0;
      if (typeof e.engagementRate === "number") rates.push(e.engagementRate);
    }

    const followerByDay = new Map(mySnaps.filter((s) => s.followers !== null).map((s) => [s.date, s.followers!]));
    const daily = days.map((date) => ({
      date,
      posts: myPosts.filter((p) => jstDay(p.publishedAt!) === date).length,
      failed: myFailed.filter((p) => jstDay(p.updatedAt) === date).length,
      revenue: inMonth.filter((r) => jstDay(r.earnedAt) === date).reduce((s, r) => s + r.amount, 0),
      followers: followerByDay.get(date) ?? null,
    }));

    const itemTotals = new Map<string, { name: string; total: number; quantity: number }>();
    for (const r of inMonth) {
      const key = r.itemId ?? `memo:${r.description ?? r.platform}`;
      const cur = itemTotals.get(key) ?? { name: r.item?.name ?? r.description ?? `${r.platform}（アイテムなし）`, total: 0, quantity: 0 };
      cur.total += r.amount;
      cur.quantity += r.quantity;
      itemTotals.set(key, cur);
    }

    const tokenExpiresInDays = a.tokenExpiry && !["x", "youtube", "reddit", "tiktok"].includes(a.platform) ? Math.floor((a.tokenExpiry.getTime() - now.getTime()) / DAY) : null;
    const vital = vitalCheck({
      isActive: a.isActive,
      lastError: a.lastError,
      posts: myPosts.length,
      failed: myFailed.length,
      tokenExpiresInDays,
      followersDelta: f.delta,
      revenue,
      prevRevenue,
      currentMonth,
      dayOfMonth,
    });

    return {
      id: a.id,
      avatarId: a.avatarId,
      avatarName: a.avatar.name,
      platform: a.platform,
      platformName: def?.name ?? a.platform,
      accountName: a.accountName,
      profileUrl: a.profileUrl,
      isActive: a.isActive,
      lastError: a.lastError,
      vital,
      posts: myPosts.length,
      failed: myFailed.length,
      scheduled: pendingBy.get(a.id) ?? 0,
      drafts: draftBy.get(a.id) ?? 0,
      successRate: myPosts.length + myFailed.length ? myPosts.length / (myPosts.length + myFailed.length) : null,
      revenue,
      prevRevenue,
      followers: a.followerCount,
      followersDelta: f.delta,
      followersUpdatedAt: a.followersUpdatedAt,
      followersError: a.followersError,
      followersAuto: !!def?.fetchProfile,
      views,
      engagements,
      engagementRate: rates.length ? rates.reduce((s, x) => s + x, 0) / rates.length : null,
      daily,
      revenueTrend: trendMonths.map((m) => {
        const r = monthRange(m);
        return { month: m, total: myRevenue.filter((x) => x.earnedAt >= r.start && x.earnedAt < r.end).reduce((s, x) => s + x.amount, 0) };
      }),
      items: [...itemTotals.values()].sort((x, y) => y.total - x.total),
    };
  });

  // アカウントを指定せずに記録した収益（アバター単位）
  const unassigned = revenues.filter((r) => !r.snsAccountId);
  const sumIn = (xs: typeof revenues, r: { start: Date; end: Date }) => xs.filter((x) => x.earnedAt >= r.start && x.earnedAt < r.end).reduce((s, x) => s + x.amount, 0);
  const all = revenues;
  const allInMonth = all.filter((r) => r.earnedAt >= start && r.earnedAt < end);

  return {
    month,
    prevMonth: shiftMonth(month, -1),
    nextMonth: currentMonth ? null : shiftMonth(month, 1),
    currentMonth,
    days,
    totals: {
      accounts: rows.length,
      posts: rows.reduce((s, r) => s + r.posts, 0),
      failed: rows.reduce((s, r) => s + r.failed, 0),
      revenue: sumIn(all, { start, end }),
      prevRevenue: sumIn(all, prev),
      unassignedRevenue: sumIn(unassigned, { start, end }),
      followers: rows.reduce((s, r) => s + (r.followers ?? 0), 0),
      followersDelta: rows.reduce((s, r) => s + (r.followersDelta ?? 0), 0),
      attention: rows.filter((r) => r.vital.level === "error" || r.vital.level === "warning").length,
      dailyRevenue: days.map((date) => ({ date, revenue: allInMonth.filter((r) => jstDay(r.earnedAt) === date).reduce((s, r) => s + r.amount, 0) })),
      revenueTrend: trendMonths.map((m) => ({ month: m, total: sumIn(all, monthRange(m)) })),
    },
    accounts: rows,
  };
}
