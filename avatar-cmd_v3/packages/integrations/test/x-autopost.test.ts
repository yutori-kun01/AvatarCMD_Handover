// X API モードの自動投稿・改善の効果検証の結合テスト（実 DB + 外部 API はモック）
// AVATAR_CMD_DB_TESTS=1 のときだけ実行（CI の使い捨て DB 用。本番 DB では実行しないこと）
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let accountId = "";
const TOUCHED = ["anthropic_api_key", "jev_api_key", "jev_mode", "ai_post_provider", "ai_review_provider"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const envKey = process.env.TYPESAFE_API_KEY;
let reviewVerdict = "ok";
// 9:05 JST（BALANCED の 09:00 の枠）
const NOW = new Date("2030-01-07T00:05:00Z");

before(async () => {
  if (!hasDb) return;
  delete process.env.TYPESAFE_API_KEY;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `x-autopost-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `自動投稿テスト-${tag}`, communication: { tone: "やさしい", topics: ["ペルソナの話題"] } } })).id;
  const acc = await svc.saveConnectedAccount(avatarId, "x", {
    accountId: `88${tag}`,
    accountName: "@auto",
    credentials: { accessToken: "AT", refreshToken: "RT", username: "auto", expiresAt: new Date(Date.now() + 86400_000).toISOString() },
  });
  accountId = acc.id;
  await svc.setSetting("anthropic_api_key", "ak-test");
});

beforeEach(async () => {
  if (!hasDb) return;
  reviewVerdict = "ok";
  await prisma.content.deleteMany({ where: { avatarId } });
  await prisma.automationRule.deleteMany({ where: { avatarId } });
  await prisma.snsAccount.update({ where: { id: accountId }, data: { settings: {}, isActive: true } });
  await prisma.avatar.update({ where: { id: avatarId }, data: { xPolicy: {}, status: "ACTIVE" } });
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  if (envKey !== undefined) process.env.TYPESAFE_API_KEY = envKey;
  await prisma.$disconnect();
});

function mocks() {
  return mockFetch([
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => ({
        text: claudeSse(c.json.model, c.json.output_config ? JSON.stringify({ verdict: reviewVerdict, summary: reviewVerdict === "ok" ? "問題なし" : "公開すべきでない", issues: [] }) : `朝の習慣のコツ ${Math.random()}`),
        headers: { "content-type": "text/event-stream" },
      }),
    ],
    ["POST", /api\.x\.com\/2\/tweets$/, { data: { id: "T1" } }],
  ]);
}

const mine = () => prisma.content.findMany({ where: { avatarId }, include: { scheduledPost: true }, orderBy: { createdAt: "asc" } });

test("X 自動投稿: オフでは作らない。オンならモードの時刻に承認なしで投稿キューへ、同じ枠は 1 回だけ", opts, async () => {
  const m = mocks();
  try {
    await svc.processXModePosts(NOW);
    assert.equal((await mine()).length, 0);
    await svc.saveXPolicy(avatarId, { autoPost: { enabled: true, topics: ["朝の習慣"] } as any });
    await svc.processXModePosts(NOW);
    const [c] = await mine();
    assert.equal(c.status, "SCHEDULED");
    assert.equal(c.scheduledPost?.status, "pending");
    assert.equal((c.metadata as any).xModeAuto, true);
    assert.equal((c.metadata as any).autoApproved, "all");
    assert.equal((c.metadata as any).title, "朝の習慣");
    // 同じ枠では作らない・30 分を過ぎた枠はさかのぼらない
    await svc.processXModePosts(new Date(NOW.getTime() + 10 * 60_000));
    await svc.processXModePosts(new Date(NOW.getTime() + 10 * 3600_000 + 40 * 60_000)); // 19:45 JST
    assert.equal((await mine()).length, 1);
  } finally {
    m.restore();
  }
});

test("X 自動投稿: トピックが空なら自動化ルールのトピックを使い、ルールは X に別の投稿を作らない", opts, async () => {
  const m = mocks();
  try {
    const rule = await svc.createRule({ avatarId, name: "X ルール", trigger: { type: "interval", hours: 24 }, action: { accountIds: [accountId], topics: ["ルールの話題"], mode: "auto", approval: "all" } });
    await svc.saveXPolicy(avatarId, { autoPost: { enabled: true } as any });
    assert.equal(await svc.runRule(rule.id), 0);
    assert.equal((await mine()).length, 0);
    await svc.processXModePosts(NOW);
    const [c] = await mine();
    assert.equal((c.metadata as any).title, "ルールの話題");
    assert.equal((c.metadata as any).sourceRuleId, rule.id);
  } finally {
    m.restore();
  }
});

test("X 自動投稿: 承認範囲 strict でチェックが NG なら下書き。オフにすると予約済みの自動投稿は送信前に止まる", opts, async () => {
  const m = mocks();
  try {
    await svc.saveXPolicy(avatarId, { autoPost: { enabled: true, approval: "strict", topics: ["朝の習慣"] } as any });
    reviewVerdict = "ng";
    await svc.processXModePosts(NOW);
    const [held] = await mine();
    assert.equal(held.status, "DRAFT");
    assert.match((held.metadata as any).heldReason, /自動投稿で保留/);

    reviewVerdict = "ok";
    await prisma.snsAccount.update({ where: { id: accountId }, data: { settings: {} } });
    await prisma.content.deleteMany({ where: { avatarId } });
    await svc.processXModePosts(NOW);
    const [queued] = await mine();
    assert.equal(queued.status, "SCHEDULED");
    await svc.saveXPolicy(avatarId, { autoPost: { enabled: false } as any });
    await prisma.scheduledPost.update({ where: { id: queued.scheduledPost!.id }, data: { scheduledAt: new Date(0) } });
    await svc.processDuePosts();
    const after = await prisma.content.findUniqueOrThrow({ where: { id: queued.id } });
    assert.notEqual(after.status, "PUBLISHED");
    assert.equal(m.calls.filter((c) => /api\.x\.com\/2\/tweets$/.test(c.url)).length, 0);
  } finally {
    m.restore();
  }
});

test("改善の効果検証: 適用後に 15% 以上悪化したルールの変更は、変更前のトピックに戻す", opts, async () => {
  const rule = await svc.createRule({ avatarId, name: "検証ルール", trigger: { type: "interval", hours: 24 }, action: { accountIds: [accountId], topics: ["新しい話題"], mode: "draft" } });
  const appliedAt = new Date(Date.now() - 30 * 86400_000);
  const change = { id: "c1", type: "rule_update", ruleId: rule.id, ruleName: rule.name, before: { topics: ["元の話題"], extraPrompt: null }, after: { topics: ["新しい話題"], extraPrompt: null }, reason: "" };
  const cycle = await prisma.improvementCycle.create({
    data: {
      avatarId,
      triggerType: "manual",
      runStatus: "completed",
      completedAt: appliedAt,
      mode: "approve",
      status: "applied",
      analysis: {},
      suggestions: [change],
      applied: { c1: { at: appliedAt.toISOString(), by: "human", baseline: { posts: 10, meanRate: 0.05 } } },
    },
  });
  // 適用後の投稿: 反応率 2%（適用前 5% から悪化）
  for (let i = 0; i < 6; i++) {
    const pub = new Date(appliedAt.getTime() + (i + 1) * 86400_000);
    await prisma.content.create({
      data: {
        avatarId,
        platform: "x",
        snsAccountId: accountId,
        content: `p${i}`,
        status: "PUBLISHED",
        category: "automation",
        publishedAt: pub,
        engagement: { views: 1000, engagements: 20, fetchedAt: new Date(pub.getTime() + 24 * 3600_000).toISOString() },
        metadata: { automationId: rule.id, title: "新しい話題" },
      },
    });
  }
  assert.ok((await svc.processImprovementVerifications()) >= 1);
  const stored = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
  assert.deepEqual((stored.actionConfig as any).topics, ["元の話題"]);
  const c = await prisma.improvementCycle.findUniqueOrThrow({ where: { id: cycle.id } });
  assert.equal((c.applied as any).c1.verification.result, "rolled_back");
  assert.equal((c.applied as any).c1.verification.after.posts, 6);
  // 2 回目は検証しない
  assert.equal(await svc.processImprovementVerifications(), 0);
});
