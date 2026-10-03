// X 引用投稿ルール（自動化ルール quote_post）の結合テスト（実 DB + 外部 API はモック）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";
import { checkInlineQuote } from "../src/post-text";

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let a1 = "";
let a2 = "";
let acc1 = "";
let acc2 = "";
const TOUCHED = ["anthropic_api_key", "jev_api_key", "jev_mode"];
let saved: { key: string; value: string; secret: boolean }[] = [];
let review = "ok";

before(async () => {
  if (!hasDb) return;
  delete process.env.TYPESAFE_API_KEY;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  await svc.setSetting("anthropic_api_key", "ak-test");
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `quote-rule-${tag}@example.com` } })).id;
  a1 = (await prisma.avatar.create({ data: { userId, name: `引用1-${tag}`, specialization: "集中力" } })).id;
  a2 = (await prisma.avatar.create({ data: { userId, name: `引用2-${tag}`, specialization: "集中力" } })).id;
  const cred = { accessToken: "AT", username: "me", expiresAt: new Date(Date.now() + 86400_000).toISOString() };
  acc1 = (await svc.saveConnectedAccount(a1, "x", { accountId: `71${tag}`, accountName: "@one", credentials: cred })).id;
  acc2 = (await svc.saveConnectedAccount(a2, "x", { accountId: `72${tag}`, accountName: "@two", credentials: cred })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.$disconnect();
});

const POSTS = [
  { id: "555000111", text: "集中力が切れたら、思い切って場所を変えるのがいちばん効く。カフェでも図書館でも、環境が変わるだけで頭が切り替わる。", author_id: "u1" },
  { id: "555000222", text: "集中できないときは、まず机の上を片付けるところから始めると、驚くほど作業に戻りやすくなると感じています。", author_id: "u9" },
];

function mocks() {
  return mockFetch([
    [
      "GET",
      /timelines\/reverse_chronological/,
      () => ({
        json: {
          data: POSTS.map((p) => ({ ...p, created_at: new Date().toISOString(), public_metrics: { like_count: 5 } })),
          includes: { users: [{ id: "u1", username: "alice", name: "A" }, { id: "u9", username: "blocked_user", name: "B" }] },
        },
      }),
    ],
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => {
        const sys = String(c.json.system ?? "");
        const text = c.json.output_config
          ? sys.includes("公開前レビュー")
            ? JSON.stringify({ verdict: review, summary: review === "ok" ? "問題なし" : "要確認", issues: [] })
            : JSON.stringify({ direction: "aligned", worth: 0.9, risk: "low", angle: "knowledge", reason: "同じ方向性" })
          : "わかります。場所を変えると脳が新しい刺激として受け取るので、作業に戻りやすくなります https://x.com/alice/status/555000111";
        return { text: claudeSse(c.json.model, text), headers: { "content-type": "text/event-stream" } };
      },
    ],
    ["POST", /api\.x\.com\/2\/tweets$/, { data: { id: "777" } }],
  ]);
}

test("引用ルール: ルールの設定（除外する相手・承認方法）で引用案を作り、自動投稿では URL を本文に入れて送る。同じ元投稿は別アバターでも使い回さない", opts, async () => {
  const m = mocks();
  try {
    await assert.rejects(
      svc.createRule({ avatarId: a1, name: "x", actionType: "quote_post", trigger: { type: "interval", hours: 24 }, action: { accountId: acc1, mode: "auto" } as any }),
      /自動承認の範囲/
    );
    const rule = await svc.createRule({
      avatarId: a1,
      name: "引用（自動）",
      actionType: "quote_post",
      trigger: { type: "interval", hours: 12 },
      action: { accountId: acc1, mode: "auto", approval: "strict", excludeAuthors: ["@Blocked_User"], scanPosts: 20 } as any,
    });
    assert.equal(rule.actionType, "quote_post");
    assert.equal(await svc.runRule(rule.id), 1);

    const cands = await prisma.quoteCandidate.findMany({ where: { avatarId: a1 }, orderBy: { externalPostId: "asc" } });
    assert.deepEqual(cands.map((c) => [c.externalPostId, c.status]), [["555000111", "approved"], ["555000222", "skipped"]]);
    assert.equal(cands[1].reason, "引用しない相手に設定済み");

    const c = await prisma.content.findFirstOrThrow({ where: { avatarId: a1, category: "quote" }, include: { scheduledPost: true } });
    assert.equal(c.status, "SCHEDULED");
    assert.equal((c.metadata as any).quote.method, "url_inline");
    assert.equal((c.metadata as any).automationId, rule.id);
    // 生成文に混ざった URL は本文に残さない（投稿時に1回だけ入れる）
    assert.ok(!c.content.includes("https://"));

    await prisma.scheduledPost.update({ where: { contentId: c.id }, data: { scheduledAt: new Date(0) } });
    await svc.processDuePosts();
    const sent = m.calls.find((x) => x.method === "POST" && /\/2\/tweets$/.test(x.url))!;
    assert.equal(sent.json.quote_tweet_id, undefined);
    assert.equal(checkInlineQuote(sent.json.text, "https://x.com/alice/status/555000111"), null);
    assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: c.id } })).status, "PUBLISHED");

    // 別のアバターの同じ元投稿は使わない（既定）
    const r2 = await svc.createRule({ avatarId: a2, name: "引用（下書き）", actionType: "quote_post", trigger: { type: "interval", hours: 24 }, action: { accountId: acc2, mode: "draft" } as any });
    assert.equal(await svc.runRule(r2.id), 1); // 555000222 だけ（a2 では除外設定なし）
    const c2 = await prisma.quoteCandidate.findFirstOrThrow({ where: { avatarId: a2, externalPostId: "555000111" } });
    assert.equal(c2.status, "skipped");
    assert.equal(c2.reason, "別のアバターで引用済み");
    const d2 = await prisma.content.findFirstOrThrow({ where: { avatarId: a2, category: "quote" } });
    assert.equal(d2.status, "DRAFT");
    assert.match((d2.metadata as any).heldReason, /引用案/);

    // 引用ルールを持つアカウントは、アカウント設定の自動探索で二重に探索しない
    await prisma.snsAccount.update({ where: { id: acc1 }, data: { settings: { quoteScanHours: "12" } } });
    const timelineCalls = m.calls.filter((x) => /timelines/.test(x.url)).length;
    await svc.processQuoteScans();
    assert.equal(m.calls.filter((x) => /timelines/.test(x.url)).length, timelineCalls);
    assert.equal(((await prisma.snsAccount.findUniqueOrThrow({ where: { id: acc1 } })).settings as any).lastQuoteScanAt, undefined);
  } finally {
    m.restore();
  }
});

test("引用ルール（自動・厳格）: 投稿前チェックが要確認なら下書きに保留し、理由を残す", opts, async () => {
  const m = mocks();
  review = "caution";
  try {
    await prisma.quoteCandidate.deleteMany({ where: { avatarId: a1 } });
    await prisma.content.deleteMany({ where: { avatarId: a1 } });
    await prisma.snsAccount.update({ where: { id: acc1 }, data: { settings: {} } });
    const rule = await svc.createRule({ avatarId: a1, name: "引用（厳格）", actionType: "quote_post", trigger: { type: "interval", hours: 24 }, action: { accountId: acc1, mode: "auto", approval: "strict", excludeAuthors: ["blocked_user"] } as any });
    await svc.runRule(rule.id);
    const c = await prisma.content.findFirstOrThrow({ where: { avatarId: a1, category: "quote" } });
    assert.equal(c.status, "DRAFT");
    assert.match((c.metadata as any).heldReason, /引用ルールの自動投稿で保留/);
  } finally {
    review = "ok";
    m.restore();
  }
});
