// 自動化ルールの編集と投稿制御の結合テスト（実 DB + 外部 API はモック）
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
const TOUCHED = ["anthropic_api_key", "jev_api_key", "jev_mode", "jev_model", "ai_post_provider", "ai_review_provider"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const envKey = process.env.TYPESAFE_API_KEY;
let reviewVerdict = "ok";
let jevStatus = 200;

before(async () => {
  if (!hasDb) return;
  delete process.env.TYPESAFE_API_KEY;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `rule-edit-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `編集テスト-${tag}`, communication: { tone: "やさしい" } } })).id;
  const acc = await svc.saveConnectedAccount(avatarId, "x", {
    accountId: `77${tag}`,
    accountName: "@me",
    credentials: { accessToken: "AT", refreshToken: "RT", username: "me", expiresAt: new Date(Date.now() + 86400_000).toISOString() },
  });
  accountId = acc.id;
  await svc.setSetting("anthropic_api_key", "ak-test");
});

beforeEach(async () => {
  if (!hasDb) return;
  reviewVerdict = "ok";
  jevStatus = 200;
  await prisma.appSetting.deleteMany({ where: { key: { in: ["jev_api_key", "jev_mode"] } } });
  await prisma.avatar.update({ where: { id: avatarId }, data: { status: "ACTIVE" } });
  await prisma.snsAccount.update({ where: { id: accountId }, data: { isActive: true } });
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
      /api\.typesafe\.ai\/v1\/systemone/,
      () =>
        jevStatus === 200
          ? {
              json: {
                model: "jev-1.13.0",
                answers: {
                  action: { type: "choice", choice: "publish", confidence: 0.9, probabilities: { publish: 0.9, review: 0.05, hold: 0.05 } },
                  personaFit: { type: "score", score: 1.8, confidence: 0.8, legend: {}, probabilities: {} },
                  salesPressure: { type: "score", score: 0.1, confidence: 0.8, legend: {}, probabilities: {} },
                  duplicateRisk: { type: "noul", noul: 0.05 },
                  brandRisk: { type: "score", score: 0.1, confidence: 0.8, legend: {}, probabilities: {} },
                },
                usage: { input_tokens: 10, output_tokens: 2 },
              },
            }
          : { status: jevStatus, json: { error: "down" } },
    ],
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => ({
        text: claudeSse(c.json.model, c.json.output_config ? JSON.stringify({ verdict: reviewVerdict, summary: reviewVerdict === "ok" ? "問題なし" : "表現が強い", issues: [] }) : `集中力のコツ ${Math.random()}`),
        headers: { "content-type": "text/event-stream" },
      }),
    ],
    ["POST", /api\.x\.com\/2\/tweets$/, { data: { id: "T1" } }],
  ]);
}

async function latest(ruleId: string) {
  return prisma.content.findFirstOrThrow({
    where: { avatarId, metadata: { path: ["automationId"], equals: ruleId } },
    orderBy: { createdAt: "desc" },
    include: { scheduledPost: true },
  });
}

const base = () => ({ accountIds: [accountId], topics: ["集中力"] });

test("ルール編集: 下書き → 自動投稿（全自動）に変えると、次の実行から投稿キューに入る", opts, async () => {
  const rule = await svc.createRule({ avatarId, name: "編集前は下書き", trigger: { type: "interval", hours: 24 }, action: { ...base(), mode: "draft" } });
  const m = mocks();
  try {
    await svc.runRule(rule.id);
    const first = await latest(rule.id);
    assert.equal(first.status, "DRAFT");
    assert.match((first.metadata as any).heldReason, /下書きモード/);

    // 画面の「編集」→ 自動投稿に変更（承認範囲は選択必須）
    await assert.rejects(svc.updateRule(rule.id, { action: { ...base(), mode: "auto" } }), /自動承認の範囲/);
    await svc.updateRule(rule.id, { action: { ...base(), mode: "auto", approval: "all" } });
    const stored = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
    assert.deepEqual((stored.actionConfig as any).mode, "auto");
    assert.deepEqual((stored.actionConfig as any).approval, "all");

    await svc.runRule(rule.id);
    const second = await latest(rule.id);
    assert.equal(second.status, "SCHEDULED");
    assert.equal(second.scheduledPost?.status, "pending");
    assert.equal((second.metadata as any).autoApproved, "all");

    // 予約キューから実際に送信される
    await prisma.scheduledPost.update({ where: { id: second.scheduledPost!.id }, data: { scheduledAt: new Date(0) } });
    await svc.processDuePosts();
    assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: second.id } })).status, "PUBLISHED");
  } finally {
    m.restore();
  }
});

test("ルール編集: 自動投稿（条件付き）でチェックが要確認なら投稿、NG なら理由付きの下書き", opts, async () => {
  const rule = await svc.createRule({ avatarId, name: "条件付き", trigger: { type: "interval", hours: 24 }, action: { ...base(), mode: "auto", approval: "standard" } });
  const m = mocks();
  try {
    reviewVerdict = "caution";
    await svc.runRule(rule.id);
    assert.equal((await latest(rule.id)).status, "SCHEDULED");
    reviewVerdict = "ng";
    await svc.runRule(rule.id);
    const held = await latest(rule.id);
    assert.equal(held.status, "DRAFT");
    assert.match((held.metadata as any).heldReason, /自動投稿ルール（NGのみ保留）で保留/);
  } finally {
    m.restore();
  }
});

test("判定障害: gate モードで Jev が失敗したら、条件付き・厳格では下書きに保留、全自動は投稿", opts, async () => {
  await svc.setSetting("jev_api_key", "tsk-test");
  await svc.setSetting("jev_mode", "gate");
  const strict = await svc.createRule({ avatarId, name: "厳格", trigger: { type: "interval", hours: 24 }, action: { ...base(), mode: "auto", approval: "strict" } });
  const all = await svc.createRule({ avatarId, name: "全自動", trigger: { type: "interval", hours: 24 }, action: { ...base(), mode: "auto", approval: "all" } });
  const m = mocks();
  try {
    jevStatus = 500;
    await svc.runRule(strict.id);
    const s = await latest(strict.id);
    assert.equal(s.status, "DRAFT");
    assert.match((s.metadata as any).heldReason, /Jev の判定に失敗/);
    await svc.runRule(all.id);
    assert.equal((await latest(all.id)).status, "SCHEDULED");
  } finally {
    m.restore();
  }
});

test("投稿直前の再確認: ルールの停止・下書きモード化・承認範囲の厳格化・アカウント停止で予約を下書きに戻す", opts, async () => {
  const rule = await svc.createRule({ avatarId, name: "直前確認", trigger: { type: "interval", hours: 24 }, action: { ...base(), mode: "auto", approval: "all" } });
  const m = mocks();
  const runAndDue = async () => {
    await svc.runRule(rule.id);
    const c = await latest(rule.id);
    assert.equal(c.status, "SCHEDULED");
    await prisma.scheduledPost.update({ where: { contentId: c.id }, data: { scheduledAt: new Date(0) } });
    return c.id;
  };
  try {
    // 1. ルールを停止（予約は残す）→ 送信直前に保留
    let id = await runAndDue();
    await svc.updateRule(rule.id, { isActive: false });
    await svc.processDuePosts();
    let c = await prisma.content.findUniqueOrThrow({ where: { id }, include: { scheduledPost: true } });
    assert.equal(c.status, "DRAFT");
    assert.equal(c.scheduledPost, null);
    assert.match((c.metadata as any).heldReason, /停止中/);
    // 下書きに戻ったものは人が承認すれば送信できる
    await svc.approveDraft(id, undefined, new Date(0));
    await svc.processDuePosts();
    assert.equal((await prisma.content.findUniqueOrThrow({ where: { id } })).status, "PUBLISHED");

    // 2. 承認範囲を厳格にした → 作成時のチェックが caution なら保留
    await svc.updateRule(rule.id, { isActive: true });
    reviewVerdict = "caution";
    id = await runAndDue();
    await svc.updateRule(rule.id, { action: { ...base(), mode: "auto", approval: "strict" } });
    await svc.processDuePosts();
    c = await prisma.content.findUniqueOrThrow({ where: { id }, include: { scheduledPost: true } });
    assert.equal(c.status, "DRAFT");
    assert.match((c.metadata as any).heldReason, /承認範囲が変更/);

    // 3. 下書きモードに変更 → 保留
    reviewVerdict = "ok";
    id = await runAndDue();
    await svc.updateRule(rule.id, { action: { ...base(), mode: "draft" } });
    await svc.processDuePosts();
    assert.match(((await prisma.content.findUniqueOrThrow({ where: { id } })).metadata as any).heldReason, /下書きモード/);

    // 4. アカウント停止 → 保留
    await svc.updateRule(rule.id, { action: { ...base(), mode: "auto", approval: "all" } });
    id = await runAndDue();
    await prisma.snsAccount.update({ where: { id: accountId }, data: { isActive: false } });
    await svc.processDuePosts();
    assert.match(((await prisma.content.findUniqueOrThrow({ where: { id } })).metadata as any).heldReason, /アカウントが停止中/);
  } finally {
    m.restore();
  }
});

test("停止時の選択: holdQueued なら既存の予約も下書きに戻す（影響範囲を事前に取得できる）", opts, async () => {
  const rule = await svc.createRule({ avatarId, name: "停止テスト", trigger: { type: "interval", hours: 24 }, action: { ...base(), mode: "auto", approval: "all" } });
  const m = mocks();
  try {
    await svc.runRule(rule.id);
    await svc.runRule(rule.id);
    // 予約日時を未来にしておく（すぐには送信されない）
    assert.equal((await svc.queuedPostsOfRule(rule.id)).length, 2);
    const r = await svc.updateRule(rule.id, { isActive: false, holdQueued: true });
    assert.equal(r.held, 2);
    assert.equal((await svc.queuedPostsOfRule(rule.id)).length, 0);
  } finally {
    m.restore();
  }
});
