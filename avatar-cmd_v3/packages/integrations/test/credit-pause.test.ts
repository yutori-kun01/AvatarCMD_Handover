// API クレジット不足による自動化の一時停止の結合テスト（実 DB + X API はモック）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch } from "./helpers";

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let accountId = "";
let credit = false;

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `credit-pause-${tag}@example.com` } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `クレジット-${tag}`, specialization: "集中力" } })).id;
  const cred = { accessToken: "AT", username: "me", expiresAt: new Date(Date.now() + 86400_000).toISOString() };
  accountId = (await svc.saveConnectedAccount(avatarId, "x", { accountId: `81${tag}`, accountName: "@credit", credentials: cred })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

function mocks() {
  let n = 0;
  return mockFetch([
    ["POST", /\/2\/tweets$/, () => (credit ? { status: 402, json: { title: "CreditsDepleted", detail: "Your enrolled account does not have any credits" } } : { json: { data: { id: `9000${++n}` } } })],
    ["GET", /timelines\/reverse_chronological/, { data: [] }],
  ]);
}

async function postOnce(text: string) {
  const [c] = await svc.createPosts({ accountIds: [accountId], text });
  await svc.processDuePosts();
  return prisma.content.findUniqueOrThrow({ where: { id: c.id } });
}

const account = () => prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId } });

test("クレジット不足が 1 回だけなら止めず、成功したら連続回数を 0 に戻す", opts, async () => {
  const m = mocks();
  try {
    credit = true;
    assert.equal((await postOnce("1 回目")).status, "FAILED");
    assert.equal((await account()).creditFailures, 1);
    assert.equal((await account()).automationPausedAt, null);
    credit = false;
    assert.equal((await postOnce("成功")).status, "PUBLISHED");
    assert.equal((await account()).creditFailures, 0);
  } finally {
    m.restore();
  }
});

test("クレジット不足が 2 回続いたら自動化を一時停止し、予約・ルール・自動の探索を止める。ボタンで再開する", opts, async () => {
  const m = mocks();
  try {
    credit = true;
    await postOnce("1 回目");
    await postOnce("2 回目");
    const acc = await account();
    assert.equal(acc.creditFailures, 2);
    assert.ok(acc.automationPausedAt, "一時停止している");
    assert.match(acc.automationPausedReason ?? "", /クレジット不足で 2 回/);
    assert.equal(await prisma.activityLog.count({ where: { avatarId, action: "automation_paused" } }), 1);

    // 予約投稿は送信せず下書きに戻す（X には送らない）
    const before = m.calls.filter((c) => c.method === "POST").length;
    const held = await postOnce("停止中の予約");
    assert.equal(held.status, "DRAFT");
    assert.match(String((held.metadata as any).heldReason), /一時停止中/);
    assert.equal(m.calls.filter((c) => c.method === "POST").length, before);

    // 投稿先が全部止まっているルールは実行しない（ルールの状態にだけ理由を出す）
    const rule = await prisma.automationRule.create({
      data: { avatarId, name: "朝の投稿", triggerType: "schedule", triggerConfig: { type: "interval", hours: 24 }, actionType: "generate_post", actionConfig: { accountIds: [accountId], topics: ["集中力"], mode: "auto", approval: "all" }, nextRunAt: new Date(Date.now() - 60_000) },
    });
    await svc.processDueRules();
    const r = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
    assert.equal(r.executionCount, 0);
    assert.match(r.lastError ?? "", /一時停止中/);
    assert.ok(r.nextRunAt && r.nextRunAt.getTime() > Date.now(), "次回の実行時刻は進める");
    assert.equal(await prisma.activityLog.count({ where: { avatarId, action: "automation_failed" } }), 0);

    // 自動の引用探索はタイムラインを読まない
    const scan = await svc.scanQuoteCandidates(accountId, { scheduled: true });
    assert.match(scan.waiting ?? "", /一時停止中/);
    assert.equal(m.calls.filter((c) => /reverse_chronological/.test(c.url)).length, 0);

    // 再開（ボタン）
    assert.deepEqual(await svc.resumeAccountAutomation(accountId), { resumed: true });
    const resumed = await account();
    assert.equal(resumed.automationPausedAt, null);
    assert.equal(resumed.creditFailures, 0);
    assert.equal(await prisma.activityLog.count({ where: { avatarId, action: "automation_resumed" } }), 1);
    credit = false;
    assert.equal((await postOnce("再開後")).status, "PUBLISHED");
    await prisma.automationRule.delete({ where: { id: rule.id } });
  } finally {
    m.restore();
  }
});
