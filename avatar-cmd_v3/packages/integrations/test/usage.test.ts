import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";
import { costOfRow, findPrice, normalizeAnthropicUsage, normalizeGeminiUsage, normalizeOpenAIUsage, type Price } from "../src/service/usage";
import { runsPerMonth } from "../src/service/cost";

const d = (s: string) => new Date(s);
const row = (p: Partial<Parameters<typeof costOfRow>[0]> = {}) => ({
  provider: "anthropic",
  model: "claude-sonnet-5",
  occurredAt: d("2026-10-02T00:00:00Z"),
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requests: 1,
  reads: 0,
  ...p,
});
const P = (p: Partial<Price>): Price => ({ provider: "anthropic", model: "*", unit: "input_token", price: 3, per: 1_000_000, currency: "USD", effectiveFrom: d("2026-01-01"), ...p });

test("使用量の正規化: キャッシュ分を入力トークンから除き、二重計上しない", () => {
  // Anthropic: input_tokens はキャッシュを含まない
  assert.deepEqual(normalizeAnthropicUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 }), { inputTokens: 100, outputTokens: 20, cacheReadTokens: 500, cacheWriteTokens: 50 });
  // OpenAI: input_tokens はキャッシュ（cached_tokens）を含む
  assert.deepEqual(normalizeOpenAIUsage({ input_tokens: 600, output_tokens: 20, input_tokens_details: { cached_tokens: 500 } }), { inputTokens: 100, outputTokens: 20, cacheReadTokens: 500, cacheWriteTokens: 0 });
  // Gemini: promptTokenCount はキャッシュを含む。思考トークンは出力に含める
  assert.deepEqual(normalizeGeminiUsage({ promptTokenCount: 600, cachedContentTokenCount: 500, candidatesTokenCount: 20, thoughtsTokenCount: 30 }), { inputTokens: 100, outputTokens: 50, cacheReadTokens: 500, cacheWriteTokens: 0 });
  assert.deepEqual(normalizeOpenAIUsage(undefined), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
});

test("費用: 単位ごとに計算し、単価が無い単位は 0 円にせず未算定にする", () => {
  const prices = [P({ unit: "input_token", price: 3 }), P({ unit: "output_token", price: 15 })];
  const c = costOfRow(row({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 10 }), prices);
  assert.equal(c.amounts.USD, 3 + 1.5);
  assert.deepEqual(c.unpriced, ["cache_read_token"]);
  // 何も登録が無いモデル
  assert.deepEqual(costOfRow(row({ provider: "openai", model: "gpt-5", inputTokens: 5 }), prices).unpriced, ["input_token"]);
  // トークン課金の行では、リクエスト単価が未登録でも未算定にしない
  assert.deepEqual(costOfRow(row({ inputTokens: 5 }), [P({})]).unpriced, []);
  // 件数だけの行（X への投稿など）は、リクエスト単価が無ければ未算定
  assert.deepEqual(costOfRow(row({ provider: "x", model: null }), prices).unpriced, ["request"]);
  // 失敗して数量が何も無い呼び出しは費用の対象外
  assert.deepEqual(costOfRow(row({ error: "timeout" }), prices), { amounts: {}, unpriced: [] });
  // 読み取り件数（X Owned Reads）
  assert.equal(costOfRow(row({ provider: "x", model: null, requests: 1, reads: 30 }), [P({ provider: "x", unit: "read", price: 0.001, per: 1 })]).amounts.USD!.toFixed(3), "0.030");
});

test("料金表: モデル個別が全モデルより優先、適用日で切り替わる", () => {
  const prices = [
    P({ model: "*", price: 1 }),
    P({ model: "claude-sonnet-5", price: 3, effectiveFrom: d("2026-01-01") }),
    P({ model: "claude-sonnet-5", price: 2, effectiveFrom: d("2026-10-01") }),
  ];
  assert.equal(findPrice(prices, "anthropic", "claude-sonnet-5", "input_token", d("2026-09-30"))!.price, 3);
  assert.equal(findPrice(prices, "anthropic", "claude-sonnet-5", "input_token", d("2026-10-01"))!.price, 2);
  assert.equal(findPrice(prices, "anthropic", "claude-haiku-4-5", "input_token", d("2026-10-01"))!.price, 1);
  assert.equal(findPrice(prices, "anthropic", "claude-sonnet-5", "input_token", d("2025-12-31")), undefined);
});

test("試算: ルールの月間実行回数", () => {
  assert.equal(Math.round(runsPerMonth({ type: "daily", times: ["09:00", "19:00"] })), 61);
  assert.equal(runsPerMonth({ type: "interval", hours: 6 }), 730 / 6);
});

// --- 実 DB ---------------------------------------------------------------------
const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };
type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let accountId = "";
const TOUCHED = ["anthropic_api_key", "jev_api_key", "jev_mode", "budget_monthly_amount", "budget_currency", "budget_warn_ratio", "budget_action", "budget_alerted"];
let saved: { key: string; value: string; secret: boolean }[] = [];
let priceIds: string[] = [];

before(async () => {
  if (!hasDb) return;
  delete process.env.TYPESAFE_API_KEY;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `usage-${tag}@example.com` } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `費用テスト-${tag}` } })).id;
  accountId = (
    await svc.saveConnectedAccount(avatarId, "x", { accountId: `88${tag}`, accountName: "@me", credentials: { accessToken: "AT", username: "me", expiresAt: new Date(Date.now() + 86400_000).toISOString() } })
  ).id;
  await svc.setSetting("anthropic_api_key", "ak-test");
});

after(async () => {
  if (!hasDb) return;
  await prisma.usageLedger.deleteMany({ where: { avatarId } });
  await prisma.priceEntry.deleteMany({ where: { id: { in: priceIds } } });
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.$disconnect();
});

test("台帳: 自動化ルールの生成・チェック・投稿がアバター・ルールに紐付いて記録され、予算の停止設定で新規生成が止まる", opts, async () => {
  const m = mockFetch([
    ["POST", /api\.anthropic\.com\/v1\/messages/, (c) => ({ text: claudeSse(c.json.model, c.json.output_config ? '{"verdict":"ok","summary":"","issues":[]}' : "本文です"), headers: { "content-type": "text/event-stream" } })],
    ["POST", /api\.x\.com\/2\/tweets$/, { data: { id: "U1" } }],
  ]);
  try {
    const rule = await svc.createRule({ avatarId, name: "費用", trigger: { type: "interval", hours: 24 }, action: { accountIds: [accountId], topics: ["t"], mode: "auto", approval: "all" } });
    await svc.runRule(rule.id);
    const rows = await prisma.usageLedger.findMany({ where: { avatarId }, orderBy: { occurredAt: "asc" } });
    assert.deepEqual(rows.map((r) => [r.provider, r.purpose, r.context, r.subjectId]), [
      ["anthropic", "post", "automation", rule.id],
      ["anthropic", "review", "automation", rule.id],
    ]);
    // claudeSse の usage: input 1 / output 5
    assert.equal(rows[0].inputTokens, 1);
    assert.equal(rows[0].outputTokens, 5);
    const c = await prisma.content.findFirstOrThrow({ where: { avatarId }, include: { scheduledPost: true } });
    await svc.publishContent(c.id);
    assert.equal((await prisma.usageLedger.findFirstOrThrow({ where: { avatarId, purpose: "post_publish" } })).requests, 1);

    // 単価を登録 → 概算が出る。投稿 API は単価未登録なので未算定として数える
    const p = await prisma.priceEntry.create({ data: svc.validatePrice({ provider: "anthropic", unit: "output_token", price: 1000, per: 1, currency: "USD", effectiveFrom: "2020-01-01" }) });
    priceIds.push(p.id);
    const now = new Date();
    const { from, to } = svc.usageMonthRange(now);
    const s = await svc.summarizeUsage(from, to);
    assert.ok((s.totals.USD ?? 0) >= 10);
    assert.ok(s.unpricedRows >= 1);

    // 予算: 警告のみ → 実行できる / 停止 → 新規生成を止める
    await svc.saveBudget({ amount: 1, currency: "USD", action: "warn" });
    await svc.runRule(rule.id);
    await svc.saveBudget({ action: "stop" });
    await assert.rejects(svc.runRule(rule.id), /予算の上限/);
    assert.ok(await prisma.activityLog.findFirst({ where: { action: "budget_over" } }));
    await assert.rejects(svc.saveBudget({ amount: -1 }), /正の数/);

    // ルール追加の増分の見積もり
    const est = await svc.estimateRuleConfig({ trigger: { type: "daily", times: ["09:00"] }, action: { accountIds: [accountId], topics: ["t"], mode: "auto", approval: "all" } });
    assert.ok(est.calls.some((x) => x.purpose === "post" && x.requests > 29));
    assert.ok((est.amounts.USD ?? 0) > 0);
  } finally {
    m.restore();
  }
});
