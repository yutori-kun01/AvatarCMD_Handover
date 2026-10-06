// ================================================
// X API の利用方針（モード）と、アバターごとの予算・自動の段階的な縮小
// ================================================
// X は読み取り 1 件ごとに課金される（Post Read $0.005 / User Read $0.010 / Post Create $0.015。単価は設定で変更可）。
// ・モード: ECO / BALANCED（既定）/ AGGRESSIVE / カスタマイズ（各項目を自由に設定）
// ・アバターごとの今月の X 費用（円）が「縮小する額」（既定 ¥800）を超えたら引用探索・指標取得を減らし、
//   「上限」（既定 ¥1,000）に達したら引用探索と引用案の作成を止める。通常投稿と自分の投稿の分析は止めない。
// ・使用量は共通台帳（usage_ledger, provider = x）から集計する。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getSetting, setSetting } from "./store";

export interface XPolicyParams {
  /** 1 日の通常投稿の回数（自動化ルールが X に予約する回数）。プリセットのモードでは固定 */
  postsPerDay: number;
  /** 通常投稿の時刻（日本時間 "HH:MM"。件数 = postsPerDay） */
  postTimes: string[];
  /** 自分の投稿の指標を取る時点（公開からの時間） */
  metricsCheckpoints: number[];
  /** 引用探索の時刻（日本時間 "HH:MM"） */
  scanTimes: string[];
  /** 1 回の引用探索で読む投稿数 */
  scanPosts: number;
  /** 引用案を詳しく判定する件数（採点の上位から） */
  shortlist: number;
  /** 月に作る引用案の上限 */
  quotesPerMonth: number;
  /** 自分のプロフィール（フォロワー数・画像）を取る間隔（日） */
  profileEveryDays: number;
  /** 投稿者情報のキャッシュ期間（日） */
  userCacheDays: number;
}

export type XMode = "eco" | "balanced" | "aggressive" | "custom";

export const X_MODES: Record<Exclude<XMode, "custom">, { label: string; help: string; params: XPolicyParams }> = {
  eco: {
    label: "ECO",
    help: "費用最小。引用探索は朝 1 回、指標は 6h / 24h",
    params: { postsPerDay: 2, postTimes: ["09:00", "19:00"], metricsCheckpoints: [6, 24], scanTimes: ["08:00"], scanPosts: 10, shortlist: 2, quotesPerMonth: 10, profileEveryDays: 2, userCacheDays: 7 },
  },
  balanced: {
    label: "BALANCED",
    help: "標準。引用探索は朝夕 2 回 × 12 件、指標は 1h / 6h / 24h",
    params: { postsPerDay: 2, postTimes: ["09:00", "19:00"], metricsCheckpoints: [1, 6, 24], scanTimes: ["08:00", "18:00"], scanPosts: 12, shortlist: 3, quotesPerMonth: 20, profileEveryDays: 1, userCacheDays: 7 },
  },
  aggressive: {
    label: "AGGRESSIVE",
    help: "反応重視。引用探索は 1 日 4 回 × 20 件、指標は 1h / 3h / 12h / 24h",
    params: { postsPerDay: 2, postTimes: ["09:00", "19:00"], metricsCheckpoints: [1, 3, 12, 24], scanTimes: ["08:00", "12:00", "17:00", "21:00"], scanPosts: 20, shortlist: 3, quotesPerMonth: 30, profileEveryDays: 1, userCacheDays: 3 },
  },
};
export const DEFAULT_X_MODE: XMode = "balanced";
export const DEFAULT_X_BUDGET = { degradeAtYen: 800, capYen: 1000 };

export interface XPolicySetting {
  mode: XMode;
  /**
   * 利用者が決めた時刻（日本時間）。プリセットのモードでは回数はモードで固定で、時刻だけ変えられる
   * （件数がモードの回数と合わない場合はモードの既定の時刻を使う）。カスタマイズでは custom の値を使う
   */
  times: { post: string[]; scan: string[] };
  /** カスタマイズの値（mode = custom のとき使う。無い項目は BALANCED の値） */
  custom: XPolicyParams;
  degradeAtYen: number;
  capYen: number;
}

// --- 検証 ------------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 時刻の一覧（重複なし・昇順） */
export function normalizeTimes(raw: unknown, max = 12): string[] {
  return Array.isArray(raw) ? [...new Set(raw.map((t) => String(t).trim()).filter((t) => TIME_RE.test(t)))].sort().slice(0, max) : [];
}

/** n 回分の既定の時刻（9:00〜21:00 に均等） */
export function defaultTimes(n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return ["09:00"];
  if (n === 2) return ["09:00", "19:00"];
  return Array.from({ length: n }, (_, i) => {
    const m = Math.round(9 * 60 + (i * 12 * 60) / (n - 1));
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
}

const int = (v: unknown, min: number, max: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function normalizeParams(raw: Partial<XPolicyParams> | null | undefined, base: XPolicyParams = X_MODES.balanced.params): XPolicyParams {
  const r = raw ?? {};
  const cps = Array.isArray(r.metricsCheckpoints) ? [...new Set(r.metricsCheckpoints.map(Number).filter((h) => Number.isFinite(h) && h >= 1).map((h) => int(h, 1, 336, 1)))].sort((a, b) => a - b).slice(0, 6) : base.metricsCheckpoints;
  const times = Array.isArray(r.scanTimes) ? normalizeTimes(r.scanTimes) : base.scanTimes;
  const postsPerDay = int(r.postsPerDay, 0, 10, base.postsPerDay);
  const postTimes = normalizeTimes(r.postTimes, 10);
  return {
    postsPerDay,
    postTimes: postTimes.length === postsPerDay ? postTimes : defaultTimes(postsPerDay),
    metricsCheckpoints: cps,
    scanTimes: times,
    scanPosts: int(r.scanPosts, 5, 100, base.scanPosts),
    shortlist: int(r.shortlist, 1, 10, base.shortlist),
    quotesPerMonth: int(r.quotesPerMonth, 0, 300, base.quotesPerMonth),
    profileEveryDays: int(r.profileEveryDays, 1, 30, base.profileEveryDays),
    userCacheDays: int(r.userCacheDays, 1, 30, base.userCacheDays),
  };
}

export function normalizeSetting(raw: Partial<XPolicySetting> | null | undefined): XPolicySetting {
  const r = raw ?? {};
  const mode: XMode = r.mode && (r.mode === "custom" || r.mode in X_MODES) ? r.mode : DEFAULT_X_MODE;
  const capYen = int(r.capYen, 0, 1_000_000, DEFAULT_X_BUDGET.capYen);
  return {
    mode,
    times: { post: normalizeTimes(r.times?.post, 10), scan: normalizeTimes(r.times?.scan) },
    custom: normalizeParams(r.custom),
    degradeAtYen: Math.min(capYen, int(r.degradeAtYen, 0, 1_000_000, DEFAULT_X_BUDGET.degradeAtYen)),
    capYen,
  };
}

/** モードの値に、利用者が決めた時刻を当てはめる（回数はモードのまま。件数が合わない時刻は使わない） */
export function paramsOf(s: XPolicySetting): XPolicyParams {
  if (s.mode === "custom") return s.custom;
  const p = X_MODES[s.mode].params;
  return {
    ...p,
    postTimes: s.times.post.length === p.postsPerDay ? s.times.post : p.postTimes,
    scanTimes: s.times.scan.length === p.scanTimes.length ? s.times.scan : p.scanTimes,
  };
}

// --- 単価・為替 ----------------------------------------------------------------------------

export interface XPricing {
  postRead: number;
  userRead: number;
  postCreate: number;
  /** 1 ドルあたりの円 */
  usdJpy: number;
}
export const DEFAULT_X_PRICING: XPricing = { postRead: 0.005, userRead: 0.01, postCreate: 0.015, usdJpy: 158 };
const PRICING_KEY = "x_pricing";

export async function getXPricing(): Promise<XPricing> {
  try {
    const raw = JSON.parse((await getSetting(PRICING_KEY)) ?? "{}") as Partial<XPricing>;
    const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : def);
    return {
      postRead: num(raw.postRead, DEFAULT_X_PRICING.postRead),
      userRead: num(raw.userRead, DEFAULT_X_PRICING.userRead),
      postCreate: num(raw.postCreate, DEFAULT_X_PRICING.postCreate),
      usdJpy: num(raw.usdJpy, DEFAULT_X_PRICING.usdJpy) || DEFAULT_X_PRICING.usdJpy,
    };
  } catch {
    return DEFAULT_X_PRICING;
  }
}

export async function saveXPricing(input: Partial<XPricing>): Promise<XPricing> {
  const cur = await getXPricing();
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_X_PRICING) as (keyof XPricing)[]) {
    if (input[k] === undefined) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || (k === "usdJpy" && n === 0)) throw new ConfigError("単価・為替は 0 以上の数値で入力してください");
    next[k] = n;
  }
  await setSetting(PRICING_KEY, JSON.stringify(next));
  return next;
}

// --- 月額の見積もり ------------------------------------------------------------------------

export interface XEstimate {
  postReads: number;
  userReads: number;
  creates: number;
  usd: number;
  yen: number;
}

/** 1 か月（30 日）の見積もり。通常投稿（ツリーは 1 件）の数はモードの postsPerDay */
export function estimateXMonthly(p: XPolicyParams, pricing: XPricing = DEFAULT_X_PRICING, postsPerDay = p.postsPerDay): XEstimate {
  const postReads = postsPerDay * 30 * p.metricsCheckpoints.length + p.scanTimes.length * p.scanPosts * 30;
  // プロフィール + 引用案の投稿者名（上位だけ・キャッシュ）。キャッシュ期間で割り引いた概算
  const userReads = Math.ceil(30 / p.profileEveryDays) + Math.ceil((p.shortlist * p.scanTimes.length * 30) / Math.max(1, p.userCacheDays * 2));
  const creates = postsPerDay * 30 + p.quotesPerMonth;
  const usd = postReads * pricing.postRead + userReads * pricing.userRead + creates * pricing.postCreate;
  return { postReads, userReads, creates, usd: Math.round(usd * 100) / 100, yen: Math.round(usd * pricing.usdJpy) };
}

// --- 今月の実績と段階 ------------------------------------------------------------------------

const JST = 9 * 3600_000;
function monthStart(now: Date): Date {
  const j = new Date(now.getTime() + JST);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1) - JST);
}
/** ユーザー情報の読み取り（User Read）として記録する用途 */
export const X_USER_READ_PURPOSES = ["x_profile", "x_user_lookup"];

export async function xUsageThisMonth(avatarId: string, now = new Date(), pricing?: XPricing): Promise<XEstimate> {
  const pr = pricing ?? (await getXPricing());
  const rows = await prisma.usageLedger.groupBy({
    by: ["purpose"],
    where: { provider: "x", avatarId, occurredAt: { gte: monthStart(now) }, error: null },
    _sum: { reads: true, requests: true },
  });
  let postReads = 0;
  let userReads = 0;
  let creates = 0;
  for (const r of rows) {
    if (X_USER_READ_PURPOSES.includes(r.purpose)) userReads += r._sum.reads ?? 0;
    else if (r.purpose === "post_publish") creates += r._sum.requests ?? 0;
    else postReads += r._sum.reads ?? 0;
  }
  const usd = postReads * pr.postRead + userReads * pr.userRead + creates * pr.postCreate;
  return { postReads, userReads, creates, usd: Math.round(usd * 1000) / 1000, yen: Math.round(usd * pr.usdJpy) };
}

export type XLevel = "normal" | "reduced" | "stopped";

/** 予算の使用状況で、モードの値を縮める */
export function degrade(p: XPolicyParams, level: XLevel): XPolicyParams {
  if (level === "normal") return p;
  return {
    ...p,
    // 指標は最後の 2 時点だけ（例: 1h/6h/24h → 6h/24h）
    metricsCheckpoints: p.metricsCheckpoints.slice(-2),
    scanTimes: level === "stopped" ? [] : p.scanTimes.slice(0, 1),
    scanPosts: Math.min(p.scanPosts, 10),
    quotesPerMonth: level === "stopped" ? 0 : p.quotesPerMonth,
  };
}

export async function getXPolicy(avatarId: string): Promise<XPolicySetting> {
  const a = await prisma.avatar.findUnique({ where: { id: avatarId }, select: { xPolicy: true } });
  if (!a) throw new ConfigError("アバターが見つかりません");
  return normalizeSetting(a.xPolicy as Partial<XPolicySetting>);
}

export async function saveXPolicy(avatarId: string, input: Partial<XPolicySetting>): Promise<XPolicySetting> {
  const cur = await getXPolicy(avatarId);
  const next = normalizeSetting({
    ...cur,
    ...input,
    times: input.times ? { ...cur.times, ...input.times } : cur.times,
    custom: input.custom ? { ...cur.custom, ...input.custom } : cur.custom,
  });
  // プリセットのモードで、回数と合わない時刻は保存しない（回数はモードで固定）
  if (next.mode !== "custom" && input.times) {
    const p = X_MODES[next.mode].params;
    // 空の一覧は「モードの既定の時刻に戻す」
    if (input.times.post?.length && next.times.post.length !== p.postsPerDay) throw new ConfigError(`通常投稿の時刻は ${p.postsPerDay} 個にしてください（${X_MODES[next.mode].label} の回数）`);
    if (input.times.scan?.length && next.times.scan.length !== p.scanTimes.length) throw new ConfigError(`引用探索の時刻は ${p.scanTimes.length} 個にしてください（${X_MODES[next.mode].label} の回数）`);
  }
  await prisma.avatar.update({ where: { id: avatarId }, data: { xPolicy: next as object } });
  return next;
}

/** いま使う値（予算の使用状況で縮めたもの）と、今月の実績 */
export async function effectiveXPolicy(avatarId: string, now = new Date()) {
  const [setting, pricing] = await Promise.all([getXPolicy(avatarId), getXPricing()]);
  const usage = await xUsageThisMonth(avatarId, now, pricing);
  const level: XLevel = setting.capYen > 0 && usage.yen >= setting.capYen ? "stopped" : setting.degradeAtYen > 0 && usage.yen >= setting.degradeAtYen ? "reduced" : "normal";
  const base = paramsOf(setting);
  return { setting, pricing, usage, level, params: degrade(base, level), base, estimate: estimateXMonthly(base, pricing) };
}

// --- 時刻・時点の判定 ------------------------------------------------------------------------

/** 直近に来た探索時刻（日本時間）。今日の時刻がまだなら前日の最後の時刻 */
export function lastScanSlot(times: string[], now = new Date()): Date | null {
  if (!times.length) return null;
  const j = new Date(now.getTime() + JST);
  const slots: Date[] = [];
  for (const dayOffset of [0, -1]) {
    for (const t of times) {
      const [h, m] = t.split(":").map(Number);
      slots.push(new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + dayOffset, h, m) - JST));
    }
  }
  return slots.filter((s) => s.getTime() <= now.getTime()).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

/** 前回の探索から、新しい探索時刻を過ぎたか */
export function scanDue(times: string[], lastScanAt: Date | null, now = new Date()): boolean {
  const slot = lastScanSlot(times, now);
  return !!slot && (!lastScanAt || lastScanAt.getTime() < slot.getTime());
}

/**
 * 次に取る指標の時点。過ぎた時点のうち最も遅いものを 1 回だけ取る（止まっていた間の時点はさかのぼって取らない）。
 * 取得済みの時点以降に新しい時点が無ければ null。
 */
export function dueCheckpoint(publishedAt: Date, done: number[], checkpoints: number[], now = new Date()): number | null {
  const ageH = (now.getTime() - publishedAt.getTime()) / 3600_000;
  const passed = checkpoints.filter((h) => ageH >= h);
  if (!passed.length) return null;
  const latest = passed[passed.length - 1];
  const lastDone = done.length ? Math.max(...done) : 0;
  return latest > lastDone ? latest : null;
}

/**
 * 自動化ルールが X に予約する通常投稿の時刻。モードの時刻のうち、まだ埋まっていない最も早い枠（既定は今日・明日）。
 * 1 日の回数は時刻の数（= モードの回数）を超えない。taken はそのアカウントの予約・投稿済みの時刻。
 */
export function nextPostSlot(postTimes: string[], taken: Date[], now = new Date(), days = 2): Date | null {
  if (!postTimes.length) return null;
  const j = new Date(now.getTime() + JST);
  for (let d = 0; d < days; d++) {
    for (const t of postTimes) {
      const [h, m] = t.split(":").map(Number);
      const slot = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + d, h, m) - JST);
      if (slot.getTime() <= now.getTime()) continue;
      // 同じ枠（前後 30 分）に予約・投稿があれば埋まっている
      if (taken.some((x) => Math.abs(x.getTime() - slot.getTime()) < 30 * 60_000)) continue;
      return slot;
    }
  }
  return null;
}
