// ================================================
// 使用量の共通台帳と費用の概算 — LLM / Jev / X / YouTube の使用量を UsageLedger に記録する
// ================================================
// ・台帳には「使用量」だけを保存し、費用は読み出し時に料金表（PriceEntry）から計算する
//   （料金表を後から直しても過去分に反映できる。適用日 effectiveFrom で単価を切り替える）。
// ・単価が登録されていない使用量は 0 円にせず「未算定」として別に数える。
// ・入力トークンは「キャッシュ分を除いた値」に正規化して保存する（各社の数え方の違いによる二重計上を防ぐ）:
//     Anthropic: input_tokens はキャッシュを含まない / cache_read・cache_creation が別
//     OpenAI:    input_tokens はキャッシュ（cached_tokens）を含む → 差し引く
//     Gemini:    promptTokenCount はキャッシュ（cachedContentTokenCount）を含む → 差し引く。思考トークンは出力に含める
// ・呼び出し元の情報（アバター・呼び出し元・再試行か）は withUsageContext で渡す（関数の引数を増やさないため）。
// ・費用は概算であり、請求確定額ではない。

import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getSetting, setSetting } from "./store";

export interface UsageContext {
  avatarId?: string | null;
  context?: string;
  subjectId?: string | null;
  isRetry?: boolean;
}

const als = new AsyncLocalStorage<UsageContext>();

/** fn の中で記録される使用量に、アバター・呼び出し元などを付ける（入れ子は内側が優先） */
export function withUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...(als.getStore() ?? {}), ...ctx }, fn);
}

export function currentUsageContext(): UsageContext {
  return als.getStore() ?? {};
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function normalizeAnthropicUsage(u: any): TokenUsage {
  return { inputTokens: n(u?.input_tokens), outputTokens: n(u?.output_tokens), cacheReadTokens: n(u?.cache_read_input_tokens), cacheWriteTokens: n(u?.cache_creation_input_tokens) };
}

export function normalizeOpenAIUsage(u: any): TokenUsage {
  const cached = n(u?.input_tokens_details?.cached_tokens);
  return { inputTokens: Math.max(0, n(u?.input_tokens) - cached), outputTokens: n(u?.output_tokens), cacheReadTokens: cached, cacheWriteTokens: 0 };
}

export function normalizeGeminiUsage(u: any): TokenUsage {
  const cached = n(u?.cachedContentTokenCount);
  return { inputTokens: Math.max(0, n(u?.promptTokenCount) - cached), outputTokens: n(u?.candidatesTokenCount) + n(u?.thoughtsTokenCount), cacheReadTokens: cached, cacheWriteTokens: 0 };
}

/** TypeSafe（Jev）の usage は形式が固定でないため、よくあるキー名から読む */
export function normalizeGenericUsage(u: any): TokenUsage {
  return {
    inputTokens: n(u?.input_tokens ?? u?.inputTokens ?? u?.prompt_tokens),
    outputTokens: n(u?.output_tokens ?? u?.outputTokens ?? u?.completion_tokens),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export interface UsageRecord extends Partial<TokenUsage> {
  provider: string;
  model?: string | null;
  purpose: string;
  requests?: number;
  reads?: number;
  quotaUnits?: number;
  error?: string | null;
  avatarId?: string | null;
  context?: string;
  subjectId?: string | null;
}

/** 使用量を台帳に記録する。記録の失敗で本来の処理を止めない */
export async function recordUsage(r: UsageRecord): Promise<void> {
  const ctx = currentUsageContext();
  try {
    await prisma.usageLedger.create({
      data: {
        provider: r.provider,
        model: r.model ?? null,
        purpose: r.purpose,
        avatarId: r.avatarId !== undefined ? r.avatarId : ctx.avatarId ?? null,
        context: r.context ?? ctx.context ?? null,
        subjectId: r.subjectId !== undefined ? r.subjectId : ctx.subjectId ?? null,
        inputTokens: n(r.inputTokens),
        outputTokens: n(r.outputTokens),
        cacheReadTokens: n(r.cacheReadTokens),
        cacheWriteTokens: n(r.cacheWriteTokens),
        requests: r.requests ?? 1,
        reads: n(r.reads),
        quotaUnits: n(r.quotaUnits),
        isRetry: !!ctx.isRetry,
        error: r.error ? r.error.slice(0, 500) : null,
      },
    });
  } catch (e) {
    console.warn("[usage] 使用量の記録に失敗しました:", e instanceof Error ? e.message : e);
  }
}

// --- 費用の計算 ---------------------------------------------------------------

export const PRICE_UNITS = ["input_token", "output_token", "cache_read_token", "cache_write_token", "request", "read"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const PRICE_UNIT_LABEL: Record<PriceUnit, string> = {
  input_token: "入力トークン",
  output_token: "出力トークン",
  cache_read_token: "キャッシュ読み取りトークン",
  cache_write_token: "キャッシュ書き込みトークン",
  request: "リクエスト",
  read: "読み取り件数",
};

export interface Price {
  provider: string;
  model: string;
  unit: string;
  price: number;
  per: number;
  currency: string;
  effectiveFrom: Date;
}

type LedgerRow = {
  provider: string;
  model: string | null;
  occurredAt: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  reads: number;
  error?: string | null;
};

export function quantities(r: Omit<LedgerRow, "provider" | "model" | "occurredAt">): Record<PriceUnit, number> {
  return {
    input_token: r.inputTokens,
    output_token: r.outputTokens,
    cache_read_token: r.cacheReadTokens,
    cache_write_token: r.cacheWriteTokens,
    request: r.requests,
    read: r.reads,
  };
}

/** その時点で有効な単価（モデル個別 → "*" の順。適用日が新しいものを優先） */
export function findPrice(prices: Price[], provider: string, model: string | null, unit: string, at: Date): Price | undefined {
  const valid = prices.filter((p) => p.provider === provider && p.unit === unit && p.effectiveFrom.getTime() <= at.getTime());
  const latest = (xs: Price[]) => xs.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  return latest(valid.filter((p) => model && p.model === model)) ?? latest(valid.filter((p) => p.model === "*"));
}

/**
 * 1行分の費用。単価がある単位だけを通貨ごとに足し、単価が無い単位（数量 > 0）は unpriced に入れる。
 * 「リクエスト」は、トークン・件数などほかの数量が無い行（例: X への投稿）でだけ未算定として扱う
 * （トークン課金の API でリクエスト単価が未登録なのは普通なので未算定にしない）。
 * 失敗した呼び出しで数量が何も無い行は費用の対象外。
 */
export function costOfRow(r: LedgerRow, prices: Price[]): { amounts: Record<string, number>; unpriced: PriceUnit[] } {
  const amounts: Record<string, number> = {};
  const unpriced: PriceUnit[] = [];
  const q = quantities(r);
  const onlyRequests = PRICE_UNITS.every((u) => u === "request" || !q[u]);
  if (r.error && onlyRequests) return { amounts, unpriced };
  for (const unit of PRICE_UNITS) {
    const qty = q[unit];
    if (!qty) continue;
    const p = findPrice(prices, r.provider, r.model, unit, r.occurredAt);
    if (p) amounts[p.currency] = (amounts[p.currency] ?? 0) + (qty * p.price) / (p.per || 1);
    else if (unit !== "request" || onlyRequests) unpriced.push(unit);
  }
  return { amounts, unpriced };
}

export async function loadPrices(): Promise<Price[]> {
  return prisma.priceEntry.findMany({ orderBy: { effectiveFrom: "desc" } });
}

// --- 集計 ---------------------------------------------------------------------

/** 月の区切りは日本時間 */
export function usageMonthRange(now = new Date(), offset = 0): { from: Date; to: Date; days: number; elapsedDays: number } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + offset;
  const from = new Date(Date.UTC(y, m, 1) - 9 * 3600_000);
  const to = new Date(Date.UTC(y, m + 1, 1) - 9 * 3600_000);
  const days = (to.getTime() - from.getTime()) / 86400_000;
  const elapsedDays = Math.min(days, Math.max(0, (now.getTime() - from.getTime()) / 86400_000));
  return { from, to, days, elapsedDays };
}

export interface UsageGroup {
  key: string;
  provider: string;
  model: string | null;
  purpose: string;
  avatarId: string | null;
  context: string | null;
  requests: number;
  errors: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reads: number;
  quotaUnits: number;
  amounts: Record<string, number>;
  /** 単価が無く費用に入っていない行の数 */
  unpricedRows: number;
  unpricedUnits: PriceUnit[];
}

/** 期間の使用量を「プロバイダ × モデル × 用途 × アバター × 呼び出し元」で集計し、費用を付ける */
export async function summarizeUsage(from: Date, to: Date, prices?: Price[]) {
  const rows = await prisma.usageLedger.findMany({ where: { occurredAt: { gte: from, lt: to } } });
  const ps = prices ?? (await loadPrices());
  const groups = new Map<string, UsageGroup>();
  const totals: Record<string, number> = {};
  let unpricedRows = 0;
  let quotaUnits = 0;
  for (const r of rows) {
    const key = [r.provider, r.model ?? "", r.purpose, r.avatarId ?? "", r.context ?? ""].join("|");
    const g =
      groups.get(key) ??
      ({ key, provider: r.provider, model: r.model, purpose: r.purpose, avatarId: r.avatarId, context: r.context, requests: 0, errors: 0, retries: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reads: 0, quotaUnits: 0, amounts: {}, unpricedRows: 0, unpricedUnits: [] } as UsageGroup);
    g.requests += r.requests;
    if (r.error) g.errors++;
    if (r.isRetry) g.retries++;
    g.inputTokens += r.inputTokens;
    g.outputTokens += r.outputTokens;
    g.cacheReadTokens += r.cacheReadTokens;
    g.cacheWriteTokens += r.cacheWriteTokens;
    g.reads += r.reads;
    g.quotaUnits += r.quotaUnits;
    quotaUnits += r.quotaUnits;
    const c = costOfRow(r, ps);
    for (const [cur, v] of Object.entries(c.amounts)) {
      g.amounts[cur] = (g.amounts[cur] ?? 0) + v;
      totals[cur] = (totals[cur] ?? 0) + v;
    }
    if (c.unpriced.length) {
      g.unpricedRows++;
      unpricedRows++;
      for (const u of c.unpriced) if (!g.unpricedUnits.includes(u)) g.unpricedUnits.push(u);
    }
    groups.set(key, g);
  }
  return { rows: rows.length, totals, unpricedRows, quotaUnits, groups: [...groups.values()] };
}

// --- 予算 ---------------------------------------------------------------------

export const BUDGET_KEYS = {
  amount: "budget_monthly_amount",
  currency: "budget_currency",
  warnRatio: "budget_warn_ratio",
  action: "budget_action",
  alerted: "budget_alerted",
} as const;

export type BudgetAction = "warn" | "stop";

export interface BudgetConfig {
  /** 月の予算（未設定なら null = 予算管理しない） */
  amount: number | null;
  currency: string;
  /** 警告を出す割合（0〜1） */
  warnRatio: number;
  /** 上限到達時: warn = 警告のみ / stop = 新規の生成・探索を止める（予約済みの投稿の送信は止めない） */
  action: BudgetAction;
}

export async function getBudget(): Promise<BudgetConfig> {
  const amount = Number(await getSetting(BUDGET_KEYS.amount));
  const ratio = Number(await getSetting(BUDGET_KEYS.warnRatio));
  return {
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: (await getSetting(BUDGET_KEYS.currency)) || "USD",
    warnRatio: Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 0.8,
    action: (await getSetting(BUDGET_KEYS.action)) === "stop" ? "stop" : "warn",
  };
}

export async function saveBudget(b: Partial<BudgetConfig>): Promise<void> {
  if (b.amount !== undefined) {
    if (b.amount !== null && !(Number.isFinite(b.amount) && b.amount > 0)) throw new ConfigError("予算は正の数で入力してください（空欄で予算管理なし）");
    await setSetting(BUDGET_KEYS.amount, b.amount === null ? null : String(b.amount));
  }
  if (b.currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(b.currency)) throw new ConfigError("通貨は USD / JPY のような3文字で入力してください");
    await setSetting(BUDGET_KEYS.currency, b.currency);
  }
  if (b.warnRatio !== undefined) {
    if (!(b.warnRatio > 0 && b.warnRatio <= 1)) throw new ConfigError("警告の割合は 1〜100% で入力してください");
    await setSetting(BUDGET_KEYS.warnRatio, String(b.warnRatio));
  }
  if (b.action !== undefined) await setSetting(BUDGET_KEYS.action, b.action === "stop" ? "stop" : "warn");
}

export interface BudgetStatus extends BudgetConfig {
  spent: number;
  ratio: number | null;
  level: "none" | "ok" | "warn" | "over";
  /** 予算の通貨で費用に入っていない（未算定・他通貨）使用量がある */
  incomplete: boolean;
}

/** 今月の使用額（予算の通貨のみ）と予算の状態 */
export async function budgetStatus(now = new Date()): Promise<BudgetStatus> {
  const cfg = await getBudget();
  const { from, to } = usageMonthRange(now);
  const s = await summarizeUsage(from, to);
  const spent = s.totals[cfg.currency] ?? 0;
  const otherCurrency = Object.keys(s.totals).some((c) => c !== cfg.currency && (s.totals[c] ?? 0) > 0);
  const ratio = cfg.amount ? spent / cfg.amount : null;
  const level = ratio === null ? "none" : ratio >= 1 ? "over" : ratio >= cfg.warnRatio ? "warn" : "ok";
  return { ...cfg, spent, ratio, level, incomplete: s.unpricedRows > 0 || otherCurrency };
}

/**
 * 新規の生成・探索の前に呼ぶ。予算の上限に達していれば、警告を記録し（月・段階ごとに1回）、
 * 「停止」設定なら ConfigError を投げる。予約済み投稿の送信や指標の取得からは呼ばない。
 */
export async function assertBudget(what: string, now = new Date()): Promise<void> {
  const st = await budgetStatus(now);
  if (st.level !== "warn" && st.level !== "over") return;
  const month = usageMonthRange(now).from.toISOString().slice(0, 7);
  const mark = `${month}:${st.level}`;
  if ((await getSetting(BUDGET_KEYS.alerted)) !== mark) {
    await setSetting(BUDGET_KEYS.alerted, mark);
    await prisma.activityLog.create({
      data: {
        action: st.level === "over" ? "budget_over" : "budget_warn",
        category: "system",
        level: st.level === "over" ? "error" : "warning",
        description: `API 費用の概算が今月の予算の ${Math.round((st.ratio ?? 0) * 100)}%（${st.spent.toFixed(2)} / ${st.amount} ${st.currency}）に達しました${st.level === "over" && st.action === "stop" ? "。新規の生成・探索を停止しています" : ""}（概算・請求確定額ではありません）`,
      },
    });
  }
  if (st.level === "over" && st.action === "stop") {
    throw new ConfigError(`今月の API 予算の上限に達したため「${what}」を停止しました（設定 > コスト で変更できます）`);
  }
}
