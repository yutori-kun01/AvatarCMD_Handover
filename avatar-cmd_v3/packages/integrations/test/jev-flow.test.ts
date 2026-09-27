// Jev 判定レイヤーの結合テスト（実 DB + 外部 API はモック）
// 設定を一時的に書き換えるため AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI で有効。本番 DB では実行しないこと）
import { after, before, test } from "node:test";
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
const TOUCHED = ["anthropic_api_key", "jev_api_key", "jev_mode", "jev_model", "ai_post_provider", "ai_review_provider", "ai_quote_provider"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const envKey = process.env.TYPESAFE_API_KEY;

before(async () => {
  if (!hasDb) return;
  delete process.env.TYPESAFE_API_KEY;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `jev-test-${tag}@example.com`, name: "t" } })).id;
  avatarId = (
    await prisma.avatar.create({
      data: { userId, name: `集中ハック-${tag}`, role: "ADHD当事者", specialization: "集中力・環境づくり", communication: { tone: "やさしい", topics: ["集中力"] } },
    })
  ).id;
  const acc = await svc.saveConnectedAccount(avatarId, "x", {
    accountId: `42${tag}`,
    accountName: "@me",
    credentials: { accessToken: "AT", refreshToken: "RT", username: "me", expiresAt: new Date(Date.now() + 86400_000).toISOString() },
  });
  accountId = acc.id;
  await svc.setSetting("anthropic_api_key", "ak-test");
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

/** Jev（TypeSafe）のモック: 質問の種類で答えを変える */
function jevAnswer(body: any) {
  const q = body.questions ?? {};
  if (q.direction) {
    const aligned = String(body.state?.post?.text ?? "").includes("場所を変える");
    return {
      direction: { type: "choice", choice: aligned ? "aligned" : "unrelated", confidence: 0.9, probabilities: { aligned: aligned ? 0.9 : 0.02, partial: 0.03, opposed: 0.02, unrelated: aligned ? 0.05 : 0.93 } },
      worth: { type: "noul", noul: aligned ? 0.85 : 0.1 },
      risk: { type: "score", score: 0.1, confidence: 0.9, legend: {}, probabilities: {} },
      angle: { type: "choice", choice: "experience", confidence: 0.7, probabilities: { knowledge: 0.3, experience: 0.7 } },
    };
  }
  if (q.action) {
    return {
      action: { type: "choice", choice: "hold", confidence: 0.8, probabilities: { publish: 0.1, review: 0.1, hold: 0.8 } },
      personaFit: { type: "score", score: 1.6, confidence: 0.8, legend: {}, probabilities: {} },
      salesPressure: { type: "score", score: 0.2, confidence: 0.8, legend: {}, probabilities: {} },
      duplicateRisk: { type: "noul", noul: 0.1 },
      brandRisk: { type: "score", score: 1.8, confidence: 0.8, legend: {}, probabilities: {} },
    };
  }
  return {};
}

function mocks() {
  return mockFetch([
    ["POST", /api\.typesafe\.ai\/v1\/systemone/, (c) => ({ json: { model: "jev-1.13.0", answers: jevAnswer(c.json), usage: { input_tokens: 10, output_tokens: 2 } } })],
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => ({
        text: claudeSse(c.json.model, c.json.output_config ? '{"verdict":"ok","summary":"問題なし","issues":[]}' : "わかります。自分も午後は場所を変えるようにしてから、作業に戻りやすくなりました。"),
        headers: { "content-type": "text/event-stream" },
      }),
    ],
    [
      "GET",
      /api\.x\.com\/2\/users\/[^/]+\/timelines\/reverse_chronological/,
      {
        data: [
          { id: "P1", text: "集中力が切れたら、思い切って場所を変えるのがいちばん効く。カフェでも図書館でも、環境が変わるだけで頭が切り替わる。", author_id: "u1", created_at: new Date().toISOString(), public_metrics: { like_count: 20, retweet_count: 3 } },
          { id: "P2", text: "RT @someone: ...", author_id: "u2", created_at: new Date().toISOString(), referenced_tweets: [{ type: "retweeted", id: "Z" }] },
          { id: "P3", text: "今日の株式市場は大きく下落しました。明日の決算発表に注目が集まっています。投資は自己責任でお願いします。", author_id: "u3", created_at: new Date().toISOString(), public_metrics: { like_count: 50 } },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }, { id: "u2", username: "bob", name: "Bob" }, { id: "u3", username: "carol", name: "Carol" }] },
      },
    ],
    ["POST", /api\.x\.com\/2\/tweets$/, { data: { id: "NEW1" } }],
  ]);
}

test("Jev キーが無ければ判定しない（既存の流れのまま）", opts, async () => {
  const before = await prisma.decisionEvent.count({ where: { avatarId } });
  assert.equal(await svc.jevConfig(), null);
  assert.equal(await svc.judgePost({ avatarId, platform: "x", text: "テスト" }), null);
  assert.equal(await prisma.decisionEvent.count({ where: { avatarId } }), before);
});

test("引用候補: タイムライン → 除外ルール → Jev 判定 → 引用文 → 下書き → 承認 → quote_tweet_id で投稿", opts, async () => {
  await svc.setSetting("jev_api_key", "tsk-test");
  await svc.setSetting("jev_mode", "shadow");
  const m = mocks();
  try {
    const r = await svc.scanQuoteCandidates(accountId, { maxResults: 20 });
    assert.equal(r.fetched, 3);
    assert.equal(r.new, 3);
    assert.equal(r.judged, 2); // リポストはコードのルールで除外
    assert.equal(r.drafted, 1);
    assert.deepEqual(r.errors, []);

    const jevCall = m.calls.find((c) => /typesafe/.test(c.url))!;
    assert.equal(jevCall.headers.authorization, "Bearer tsk-test");
    assert.equal(jevCall.json.model, "jev-1.13.0");

    const cands = await prisma.quoteCandidate.findMany({ where: { avatarId }, orderBy: { externalPostId: "asc" } });
    assert.deepEqual(cands.map((c) => [c.externalPostId, c.status]), [["P1", "drafted"], ["P2", "skipped"], ["P3", "skipped"]]);
    assert.equal(cands[1].reason, "リポスト");
    assert.match(cands[2].reason!, /方向性/);

    const draft = await prisma.content.findUniqueOrThrow({ where: { id: cands[0].contentId! } });
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.category, "quote");
    assert.equal((draft.metadata as any).quote.postId, "P1");
    assert.equal((draft.metadata as any).quoteJudgement.engine, "jev");
    assert.equal((draft.metadata as any).review.verdict, "ok");

    const events = await prisma.decisionEvent.findMany({ where: { avatarId, decisionType: "quote_candidate" } });
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.engine === "jev" && e.mode === "shadow"));

    // 承認 → 人の判断を記録 → 引用として投稿
    await svc.approveDraft(draft.id);
    const ev = await prisma.decisionEvent.findFirstOrThrow({ where: { subjectId: cands[0].id } });
    assert.equal(ev.humanAction, "approved");
    assert.equal((await prisma.quoteCandidate.findUniqueOrThrow({ where: { id: cands[0].id } })).status, "approved");
    await svc.publishContent(draft.id);
    const post = m.calls.find((c) => c.method === "POST" && /\/2\/tweets$/.test(c.url))!;
    assert.equal(post.json.quote_tweet_id, "P1");

    // 2回目: since_id で続きから取り、同じ投稿は二重に判定しない
    const r2 = await svc.scanQuoteCandidates(accountId, { maxResults: 20 });
    assert.equal(new URL(m.calls.filter((c) => /timelines/.test(c.url)).at(-1)!.url).searchParams.get("since_id"), "P3");
    assert.equal(r2.new, 0);
  } finally {
    m.restore();
  }
});

test("gate モード: Jev が hold と判定した自動投稿は下書きに回る（判定は反映済みとして記録）", opts, async () => {
  await svc.setSetting("jev_api_key", "tsk-test");
  await svc.setSetting("jev_mode", "gate");
  const rule = await prisma.automationRule.create({
    data: {
      avatarId,
      name: "朝の投稿",
      triggerType: "schedule",
      triggerConfig: { type: "interval", hours: 24 },
      actionType: "generate_post",
      actionConfig: { accountIds: [accountId], topics: ["集中力"], mode: "auto" },
    },
  });
  const m = mocks();
  try {
    const n = await svc.runRule(rule.id);
    assert.equal(n, 1);
    const c = await prisma.content.findFirstOrThrow({ where: { avatarId, category: "automation" }, include: { scheduledPost: true } });
    assert.equal(c.status, "DRAFT");
    assert.equal(c.scheduledPost, null);
    assert.equal((c.metadata as any).jev.publish, false);
    const ev = await prisma.decisionEvent.findFirstOrThrow({ where: { subjectId: c.id, decisionType: "post_gate" } });
    assert.equal(ev.applied, true);
    assert.equal(ev.selectedAction, "hold");
    const log = await prisma.activityLog.findFirst({ where: { avatarId, action: "automation_review_held" } });
    assert.match(log!.description, /Jev/);

    // 下書きの削除は「却下」として記録
    await svc.discardContent(c.id);
    assert.equal((await prisma.decisionEvent.findUniqueOrThrow({ where: { id: ev.id } })).humanAction, "rejected");

    // 改善か継続か: データ不足なら Jev を呼ばずルール判定
    const before = m.calls.filter((x) => /typesafe/.test(x.url)).length;
    const p = await svc.evaluateRulePerformance(rule.id);
    assert.equal(p.verdict, "insufficient");
    assert.equal(p.engine, "rule");
    assert.equal(m.calls.filter((x) => /typesafe/.test(x.url)).length, before);
  } finally {
    m.restore();
  }
});
