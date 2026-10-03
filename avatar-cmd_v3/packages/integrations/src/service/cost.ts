// ================================================
// API 費用の試算 — 設定（ルールの実行回数・探索の設定）と、台帳の平均使用量から月額を見積もる
// ================================================
// 3つを分けて出す（いずれも概算であり、請求確定額ではない）:
//   1. 設定からの月額試算（estimateMonthly）… 有効なルール・引用探索・指標取得を 1 か月動かした場合
//   2. 実際の使用量に基づく概算（usage.ts の summarizeUsage）
//   3. 月末予測（forecastMonth）と、ルールを追加した場合の増分（estimateRuleConfig）
// 1回あたりのトークン数は、台帳の直近 30 日の平均（無ければ既定値）を使う。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { AI_TASKS, resolveAi, type AiTask } from "./llm";
import { jevConfig } from "./decision";
import { taskForPlatform } from "./ai";
import { validateAction, validateTrigger, type ActionConfig, type TriggerConfig } from "./automation";
import { costOfRow, loadPrices, summarizeUsage, usageMonthRange, type Price, type PriceUnit } from "./usage";
import { QUOTE_RULES, type QuoteActionConfig } from "./quotes";

const DAY = 86400_000;
const HOURS_PER_MONTH = 730;

/** 台帳に実績が無いときの 1 回あたりの想定トークン数 */
export const DEFAULT_TOKENS: Record<string, { input: number; output: number }> = {
  post: { input: 900, output: 400 },
  article: { input: 1200, output: 4000 },
  rewrite: { input: 1000, output: 300 },
  review: { input: 800, output: 250 },
  quote: { input: 900, output: 300 },
  tags: { input: 400, output: 60 },
  jev: { input: 800, output: 60 },
  youtube_summary: { input: 8000, output: 800 },
  improvement: { input: 3000, output: 800 },
};

export interface EstimateCall {
  provider: string;
  model: string | null;
  purpose: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reads: number;
  /** 1回あたりのトークン数の出所 */
  basis: "actual" | "default" | "count";
}

export interface EstimateItem {
  kind: "rule" | "quote_scan" | "metrics" | "other";
  id?: string;
  label: string;
  avatarId?: string;
  runsPerMonth: number;
  calls: EstimateCall[];
  amounts: Record<string, number>;
  unpriced: PriceUnit[];
  /** AI のキー未設定などで見積もれない部分 */
  notes: string[];
}

type Averages = Map<string, { input: number; output: number; reads: number; rows: number }>;

/** 台帳の直近 30 日の、プロバイダ×モデル×用途ごとの 1 回あたり平均 */
async function averages(now: Date): Promise<Averages> {
  const rows = await prisma.usageLedger.groupBy({
    by: ["provider", "model", "purpose"],
    where: { occurredAt: { gte: new Date(now.getTime() - 30 * DAY) }, error: null },
    _sum: { inputTokens: true, outputTokens: true, reads: true, requests: true },
    _count: { _all: true },
  });
  const m: Averages = new Map();
  for (const r of rows) {
    const k = r._count._all;
    m.set(`${r.provider}|${r.model ?? ""}|${r.purpose}`, { input: (r._sum.inputTokens ?? 0) / k, output: (r._sum.outputTokens ?? 0) / k, reads: (r._sum.reads ?? 0) / k, rows: k });
  }
  return m;
}

function llmCall(avg: Averages, provider: string | null, model: string | null, purpose: string, requests: number, defaultKey = purpose): EstimateCall {
  const a = provider ? avg.get(`${provider}|${model ?? ""}|${purpose}`) : undefined;
  const d = DEFAULT_TOKENS[defaultKey] ?? DEFAULT_TOKENS.post;
  return {
    provider: provider ?? "(未設定)",
    model,
    purpose,
    requests,
    inputTokens: Math.round((a ? a.input : d.input) * requests),
    outputTokens: Math.round((a ? a.output : d.output) * requests),
    reads: 0,
    basis: a && a.rows >= 3 ? "actual" : "default",
  };
}

function price(item: Omit<EstimateItem, "amounts" | "unpriced">, prices: Price[], now: Date): EstimateItem {
  const amounts: Record<string, number> = {};
  const unpriced = new Set<PriceUnit>();
  for (const c of item.calls) {
    if (!c.requests && !c.reads) continue;
    const r = costOfRow({ provider: c.provider, model: c.model, occurredAt: now, inputTokens: c.inputTokens, outputTokens: c.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, requests: c.requests, reads: c.reads }, prices);
    for (const [cur, v] of Object.entries(r.amounts)) amounts[cur] = (amounts[cur] ?? 0) + v;
    r.unpriced.forEach((u) => unpriced.add(u));
  }
  return { ...item, amounts, unpriced: [...unpriced] };
}

export function runsPerMonth(t: TriggerConfig): number {
  return t.type === "daily" ? t.times.length * (365 / 12) : HOURS_PER_MONTH / t.hours;
}

/** 自動化ルール 1 件（保存前の設定でもよい）の月間の使用量 */
async function ruleItem(
  rule: { id?: string; name: string; avatarId?: string; trigger: TriggerConfig; action: ActionConfig },
  ctx: { avg: Averages; jev: boolean; platforms: Map<string, string>; rewriteRate: number }
): Promise<Omit<EstimateItem, "amounts" | "unpriced">> {
  const runs = runsPerMonth(validateTrigger(rule.trigger));
  const action = validateAction(rule.action);
  const platforms = [...new Set(action.accountIds.map((id) => ctx.platforms.get(id)).filter((p): p is string => !!p))];
  const calls: EstimateCall[] = [];
  const notes: string[] = [];
  for (const platform of platforms) {
    const task: AiTask = taskForPlatform(platform);
    const gen = await resolveAi(task);
    if (!gen.provider) notes.push(`${AI_TASKS[task].label} の AI が未設定`);
    calls.push(llmCall(ctx.avg, gen.provider, gen.model, task, runs));
    const rw = await resolveAi("rewrite");
    if (task === "post" && ctx.rewriteRate > 0) calls.push(llmCall(ctx.avg, rw.provider, rw.model, "rewrite", runs * ctx.rewriteRate));
    if (action.mode === "auto") {
      const rv = await resolveAi("review");
      calls.push(llmCall(ctx.avg, rv.provider, rv.model, "review", runs));
    }
    if (ctx.jev) calls.push(llmCall(ctx.avg, "typesafe", null, "jev_post_gate", runs, "jev"));
    calls.push({ provider: platform, model: null, purpose: "post_publish", requests: action.mode === "auto" ? runs * action.accountIds.filter((id) => ctx.platforms.get(id) === platform).length : 0, inputTokens: 0, outputTokens: 0, reads: 0, basis: "count" });
  }
  if (!platforms.length) notes.push("有効な投稿先アカウントがありません");
  return { kind: "rule", id: rule.id, label: rule.name, avatarId: rule.avatarId, runsPerMonth: runs, calls, notes };
}

async function context(now: Date) {
  const [avg, jev, accounts, rewrites, posts] = await Promise.all([
    averages(now),
    jevConfig(),
    prisma.snsAccount.findMany({ select: { id: true, platform: true, isActive: true, settings: true, avatarId: true, accountName: true } }),
    prisma.usageLedger.count({ where: { purpose: "rewrite", occurredAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
    prisma.usageLedger.count({ where: { purpose: "post", occurredAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
  ]);
  return {
    avg,
    jev: !!jev,
    accounts,
    platforms: new Map(accounts.filter((a) => a.isActive).map((a) => [a.id, a.platform])),
    // 文字数オーバーで書き直す割合（実績が少なければ 20% と仮定）
    rewriteRate: posts >= 10 ? Math.min(1, rewrites / posts) : 0.2,
  };
}

/** 1. 設定からの月額試算（有効なものを 1 か月動かした場合） */
export async function estimateMonthly(now = new Date()) {
  const ctx = await context(now);
  const prices = await loadPrices();
  const items: EstimateItem[] = [];

  const rules = await prisma.automationRule.findMany({ where: { isActive: true, actionType: "generate_post", avatar: { status: "ACTIVE" } } });
  for (const r of rules) {
    try {
      items.push(price(await ruleItem({ id: r.id, name: r.name, avatarId: r.avatarId, trigger: r.triggerConfig as unknown as TriggerConfig, action: r.actionConfig as unknown as ActionConfig }, ctx), prices, now));
    } catch (e) {
      items.push(price({ kind: "rule", id: r.id, label: r.name, avatarId: r.avatarId, runsPerMonth: 0, calls: [], notes: [`設定を読めません: ${(e as Error).message}`] }, prices, now));
    }
  }

  // 引用投稿ルール（quote_post）: 1回あたり タイムラインの読み取り + 判定（上限）+ 引用文（上限）+ チェック
  const quoteRules = await prisma.automationRule.findMany({ where: { isActive: true, actionType: "quote_post", avatar: { status: "ACTIVE" } } });
  for (const r of quoteRules) {
    const c = r.actionConfig as unknown as QuoteActionConfig;
    const runs = runsPerMonth(validateTrigger(r.triggerConfig as unknown as TriggerConfig));
    const q = await resolveAi("quote");
    const rv = await resolveAi("review");
    const calls: EstimateCall[] = [
      { provider: "x", model: null, purpose: "x_timeline", requests: runs, inputTokens: 0, outputTokens: 0, reads: (c.scanPosts ?? 30) * runs, basis: "count" },
      ctx.jev ? llmCall(ctx.avg, "typesafe", null, "jev_quote_candidate", runs * (c.maxJudged ?? QUOTE_RULES.maxJudged), "jev") : llmCall(ctx.avg, q.provider, q.model, "quote", runs * (c.maxJudged ?? QUOTE_RULES.maxJudged)),
      llmCall(ctx.avg, q.provider, q.model, "quote", runs * (c.maxDrafts ?? QUOTE_RULES.maxDrafts)),
      llmCall(ctx.avg, rv.provider, rv.model, "review", runs * (c.maxDrafts ?? QUOTE_RULES.maxDrafts)),
    ];
    items.push(price({ kind: "rule", id: r.id, label: `${r.name}（X 引用・上限で見積もり）`, avatarId: r.avatarId, runsPerMonth: runs, calls, notes: [] }, prices, now));
  }

  // 引用候補の探索（アカウント設定で有効なもの）: タイムラインの読み取り + 判定（最大 maxJudged）+ 引用文（最大 maxDrafts）+ チェック
  for (const a of ctx.accounts.filter((x) => x.isActive && x.platform === "x")) {
    const s = (a.settings ?? {}) as Record<string, unknown>;
    const hours = Number(s.quoteScanHours);
    if (!hours) continue;
    const runs = HOURS_PER_MONTH / hours;
    const reads = (Number(s.quoteScanPosts) || 30) * runs;
    const q = await resolveAi("quote");
    const rv = await resolveAi("review");
    const calls: EstimateCall[] = [
      { provider: "x", model: null, purpose: "x_timeline", requests: runs, inputTokens: 0, outputTokens: 0, reads, basis: "count" },
      ctx.jev ? llmCall(ctx.avg, "typesafe", null, "jev_quote_candidate", runs * QUOTE_RULES.maxJudged, "jev") : llmCall(ctx.avg, q.provider, q.model, "quote", runs * QUOTE_RULES.maxJudged),
      llmCall(ctx.avg, q.provider, q.model, "quote", runs * QUOTE_RULES.maxDrafts),
      llmCall(ctx.avg, rv.provider, rv.model, "review", runs * QUOTE_RULES.maxDrafts),
    ];
    items.push(price({ kind: "quote_scan", id: a.id, label: `引用候補の探索 ${a.accountName}（上限で見積もり）`, avatarId: a.avatarId, runsPerMonth: runs, calls, notes: [] }, prices, now));
  }

  // 指標の取得・動画の要約・改善処理: 回数が設定から決まらないため、直近 30 日の実績をそのまま 1 か月分とする
  const CONTEXT_LABEL: Record<string, string> = { metrics: "投稿の反応の取得", youtube: "YouTube（字幕取得・要約）", improvement: "改善処理（14〜27日ごと）" };
  const actual = await prisma.usageLedger.groupBy({
    by: ["context", "provider", "model", "purpose"],
    where: { context: { in: Object.keys(CONTEXT_LABEL) }, occurredAt: { gte: new Date(now.getTime() - 30 * DAY) } },
    _sum: { reads: true, requests: true, inputTokens: true, outputTokens: true, quotaUnits: true },
  });
  for (const ctxName of Object.keys(CONTEXT_LABEL)) {
    const rows = actual.filter((m) => m.context === ctxName);
    if (!rows.length) continue;
    const quota = rows.reduce((s, m) => s + (m._sum.quotaUnits ?? 0), 0);
    items.push(
      price(
        {
          kind: ctxName === "metrics" ? "metrics" : "other",
          label: `${CONTEXT_LABEL[ctxName]}（直近30日の実績）`,
          runsPerMonth: rows.reduce((s, m) => s + (m._sum.requests ?? 0), 0),
          calls: rows.map((m) => ({ provider: m.provider, model: m.model, purpose: m.purpose, requests: m._sum.requests ?? 0, inputTokens: m._sum.inputTokens ?? 0, outputTokens: m._sum.outputTokens ?? 0, reads: m._sum.reads ?? 0, basis: "actual" as const })),
          notes: quota ? [`YouTube クォータ ${quota} ユニット（金額とは別）`] : [],
        },
        prices,
        now
      )
    );
  }

  return { items, totals: sumAmounts(items), unpricedItems: items.filter((i) => i.unpriced.length).length };
}

/** 3b. 保存前のルール設定で、追加した場合の月額の増分を見積もる */
export async function estimateRuleConfig(rule: { name?: string; avatarId?: string; trigger: TriggerConfig; action: ActionConfig }, now = new Date()) {
  const ctx = await context(now);
  return price(await ruleItem({ name: rule.name || "新しいルール", avatarId: rule.avatarId, trigger: rule.trigger, action: rule.action }, ctx), await loadPrices(), now);
}

/** 3a. 月末予測: 今月の実績 ÷ 経過日数 × 月の日数（直線予測） */
export async function forecastMonth(now = new Date()) {
  const { from, to, days, elapsedDays } = usageMonthRange(now);
  const actual = await summarizeUsage(from, to);
  const scale = elapsedDays >= 1 ? days / elapsedDays : null;
  const forecast = Object.fromEntries(Object.entries(actual.totals).map(([c, v]) => [c, scale ? v * scale : null]));
  return { from, to, days, elapsedDays, actual, forecast, reliable: elapsedDays >= 3 };
}

function sumAmounts(items: { amounts: Record<string, number> }[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const i of items) for (const [c, v] of Object.entries(i.amounts)) t[c] = (t[c] ?? 0) + v;
  return t;
}

// --- 料金表 ---------------------------------------------------------------------

export interface PriceInput {
  provider: string;
  model?: string;
  unit: string;
  price: number;
  per?: number;
  currency?: string;
  effectiveFrom: string | Date;
  checkedAt?: string | Date;
  note?: string;
}

export function validatePrice(p: PriceInput) {
  const units = ["input_token", "output_token", "cache_read_token", "cache_write_token", "request", "read"];
  if (!p.provider?.trim()) throw new ConfigError("プロバイダを入力してください");
  if (!units.includes(p.unit)) throw new ConfigError("課金単位が不正です");
  const price = Number(p.price);
  if (!Number.isFinite(price) || price < 0) throw new ConfigError("単価は 0 以上の数で入力してください");
  const per = Number(p.per ?? 1);
  if (!Number.isInteger(per) || per < 1) throw new ConfigError("「あたり」の数量は 1 以上の整数で入力してください");
  const currency = (p.currency || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ConfigError("通貨は USD / JPY のような3文字で入力してください");
  const effectiveFrom = new Date(p.effectiveFrom);
  const checkedAt = new Date(p.checkedAt ?? new Date());
  if (Number.isNaN(effectiveFrom.getTime()) || Number.isNaN(checkedAt.getTime())) throw new ConfigError("適用日・確認日が不正です");
  return { provider: p.provider.trim(), model: p.model?.trim() || "*", unit: p.unit, price, per, currency, effectiveFrom, checkedAt, note: p.note?.trim() || null };
}
