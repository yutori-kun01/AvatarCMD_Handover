// note 記事の自動化: 公開のタイミング・有料ラインの判定（純粋関数）と、公開前チェック・保留の結合テスト（実 DB + AI はモック）
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";
import { hasPaywall, nextPublishAt, normalizePublishTiming } from "../src/service/article-gate";

test("公開のタイミング: すぐ / N 時間後 / 曜日・時刻（予約済みの枠と 1 時間以内は避ける）", () => {
  const now = new Date("2026-10-12T01:00:00Z"); // 月曜 10:00 JST
  assert.equal(nextPublishAt({ type: "now" }, now), undefined);
  assert.equal(nextPublishAt({ type: "delay", hours: 12 }, now)!.toISOString(), "2026-10-12T13:00:00.000Z");
  const weekly = normalizePublishTiming({ type: "weekly", weekdays: [2, 5, 2, 9], time: "20:00" });
  assert.deepEqual(weekly, { type: "weekly", weekdays: [2, 5], time: "20:00" });
  assert.equal(nextPublishAt(weekly, now)!.toISOString(), "2026-10-13T11:00:00.000Z"); // 火 20:00
  assert.equal(nextPublishAt(weekly, now, [new Date("2026-10-13T11:00:00Z")])!.toISOString(), "2026-10-16T11:00:00.000Z"); // 金 20:00
  // 当日の枠でも 1 時間以内なら次の枠
  assert.equal(nextPublishAt({ type: "weekly", weekdays: [1], time: "10:30" }, now)!.toISOString(), "2026-10-19T01:30:00.000Z");
  assert.throws(() => normalizePublishTiming({ type: "weekly", weekdays: [], time: "20:00" }), /曜日/);
  assert.throws(() => normalizePublishTiming({ type: "delay", hours: 0 }), /1〜336/);
  assert.deepEqual(normalizePublishTiming({ type: "nope" }), { type: "now" });
});

test("有料ライン: 単独の行の <!-- paywall --> だけ", () => {
  assert.equal(hasPaywall("導入\n\n<!-- paywall -->\n\n本編"), true);
  assert.equal(hasPaywall("本文の中の <!-- paywall --> は数えない"), false);
});

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let accountId = "";
let templateId = "";
const TOUCHED = ["anthropic_api_key", "ai_post_provider", "ai_review_provider", "article_templates", "worker_heartbeat"];
let saved: { key: string; value: string; secret: boolean }[] = [];
let drafts: string[] = [];
let reviewVerdict = "ok";
let draftCalls = 0;

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `article-gate-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `記事テスト-${tag}` } })).id;
  accountId = (await svc.saveConnectedAccount(avatarId, "note", { accountId: `n${tag}`, accountName: "note-me", credentials: { cookie: "c" } })).id;
  await svc.setSetting("anthropic_api_key", "ak-test");
  templateId = (await svc.saveArticleTemplate({ name: "有料テンプレ", paid: true, price: 500, visuals: false, eyecatch: false, publish: "publish" })).id;
});

beforeEach(async () => {
  if (!hasDb) return;
  drafts = [];
  reviewVerdict = "ok";
  draftCalls = 0;
  await prisma.content.deleteMany({ where: { avatarId } });
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.$disconnect();
});

function mocks() {
  return mockFetch([
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => {
        const isDraft = JSON.stringify(c.json.output_config ?? {}).includes("markdown");
        if (isDraft) draftCalls++;
        const body = isDraft
          ? JSON.stringify({ title: "集中のコツ", topic: "集中", markdown: drafts.shift() ?? "導入\n\n## 本編\n\n内容" })
          : JSON.stringify({ verdict: reviewVerdict, summary: reviewVerdict === "ok" ? "問題なし" : "誇大な表現", issues: [] });
        return { text: claudeSse(c.json.model, body), headers: { "content-type": "text/event-stream" } };
      },
    ],
  ]);
}

const WITH_PAYWALL = "導入\n\n<!-- paywall -->\n\n## 本編\n\n内容";

test("有料ラインが入らない: retry は 1 回書き直し、だめなら note に送らず下書き（承認待ち）", opts, async () => {
  const m = mocks();
  try {
    drafts = ["導入のみ", "まだ入らない"];
    const r = await svc.runFullArticle({ avatarId, templateId, topic: "集中", gate: { approval: "all", paywallFallback: "retry" } });
    assert.equal(draftCalls, 2);
    assert.match(r.heldReason ?? "", /書き直しても有料ライン/);
    const c = await prisma.content.findUniqueOrThrow({ where: { id: r.contentId }, include: { scheduledPost: true } });
    assert.equal(c.status, "DRAFT");
    assert.equal(c.scheduledPost, null);

    // 書き直しで入れば、有料記事として入稿
    drafts = ["導入のみ", WITH_PAYWALL];
    const ok = await svc.runFullArticle({ avatarId, templateId, topic: "集中", gate: { approval: "all", paywallFallback: "retry" } });
    assert.equal(ok.heldReason, undefined);
    const c2 = await prisma.content.findUniqueOrThrow({ where: { id: ok.contentId } });
    assert.equal(c2.status, "SCHEDULED");
    assert.equal((c2.metadata as any).options.price, "500");
  } finally {
    m.restore();
  }
});

test("公開前チェック: NG（NG のみ保留）は予定時刻つきの下書き。承認するとその時刻に予約。OK ならそのまま予約", opts, async () => {
  const m = mocks();
  const at = new Date(Date.now() + 2 * 86400_000);
  try {
    drafts = [WITH_PAYWALL];
    reviewVerdict = "ng";
    const held = await svc.runFullArticle({ avatarId, templateId, topic: "集中", scheduledAt: at, gate: { approval: "standard", paywallFallback: "free" } });
    assert.match(held.heldReason ?? "", /公開前チェックで保留/);
    await svc.approveDraft(held.contentId);
    const approved = await prisma.content.findUniqueOrThrow({ where: { id: held.contentId }, include: { scheduledPost: true } });
    assert.equal(approved.status, "SCHEDULED");
    assert.equal(approved.scheduledPost!.scheduledAt.toISOString(), at.toISOString());

    drafts = [WITH_PAYWALL];
    reviewVerdict = "ok";
    const ok = await svc.runFullArticle({ avatarId, templateId, topic: "集中", scheduledAt: at, gate: { approval: "standard", paywallFallback: "free" } });
    const c = await prisma.content.findUniqueOrThrow({ where: { id: ok.contentId }, include: { scheduledPost: true } });
    assert.equal(c.status, "SCHEDULED");
    assert.equal(c.scheduledPost!.scheduledAt.toISOString(), at.toISOString());
    assert.equal((c.metadata as any).review.verdict, "ok");
  } finally {
    m.restore();
  }
});

test("note 記事ルール: 曜日・時刻の公開タイミングで予約し、公開前チェックの設定を記事ジョブに渡す", opts, async () => {
  // worker が動いている扱いにして、記事ジョブをこのプロセスで実行させない（ジョブの入力だけを確かめる）
  await svc.setSetting(svc.SETTING_KEYS.workerHeartbeat, new Date().toISOString());
  const rule = await svc.createRule({
    avatarId,
    name: "週刊記事",
    actionType: "note_article",
    trigger: { type: "interval", hours: 24 },
    action: { accountId, templateId, topics: ["集中"], approval: "strict", paywallFallback: "hold", publishTiming: { type: "weekly", weekdays: [2], time: "20:00" } } as any,
  });
  const stored = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
  assert.deepEqual((stored.actionConfig as any).publishTiming, { type: "weekly", weekdays: [2], time: "20:00" });
  await svc.runRule(rule.id);
  const job = await prisma.articleJob.findFirstOrThrow({ where: { avatarId }, orderBy: { createdAt: "desc" } });
  const input = job.input as any;
  assert.deepEqual(input.gate, { approval: "strict", paywallFallback: "hold" });
  const at = new Date(input.scheduledAt);
  assert.equal(new Date(at.getTime() + 9 * 3600_000).getUTCDay(), 2);
  assert.equal(new Date(at.getTime() + 9 * 3600_000).getUTCHours(), 20);
  await prisma.articleJob.deleteMany({ where: { avatarId } });
});

test("記事カレンダー: 作成予定（テーマ順）・保留中・公開予定を時刻順に並べる", opts, async () => {
  const m = mocks();
  try {
    await svc.setSetting(svc.SETTING_KEYS.workerHeartbeat, new Date().toISOString());
    const rule = await svc.createRule({ avatarId, name: "毎日記事", actionType: "note_article", trigger: { type: "interval", hours: 24 }, action: { accountId, templateId, topics: ["A", "B"] } as any });
    const at = new Date(Date.now() + 3 * 86400_000);
    drafts = [WITH_PAYWALL];
    reviewVerdict = "ng";
    await svc.runFullArticle({ avatarId, templateId, topic: "集中", ruleId: rule.id, scheduledAt: at, gate: { approval: "strict", paywallFallback: "free" } });
    drafts = [WITH_PAYWALL];
    reviewVerdict = "ok";
    await svc.runFullArticle({ avatarId, templateId, topic: "集中", ruleId: rule.id, scheduledAt: new Date(at.getTime() + 86400_000), gate: { approval: "strict", paywallFallback: "free" } });
    const items = (await svc.articleCalendar({ avatarIds: [avatarId], days: 7 })).filter((i) => i.ruleId === rule.id);
    const creations = items.filter((i) => i.kind === "creation");
    assert.deepEqual(creations.slice(0, 3).map((i) => i.title), ["A", "B", "A"]);
    const held = items.find((i) => i.kind === "held")!;
    assert.equal(held.at, at.toISOString());
    assert.match(held.heldReason ?? "", /公開前チェック/);
    const scheduled = items.find((i) => i.kind === "scheduled")!;
    assert.equal(scheduled.price, "500");
    assert.ok(items.every((x, i) => i === 0 || items[i - 1].at <= x.at));
  } finally {
    m.restore();
  }
});

test("note 記事ルールの見積もり: 執筆・チェック・画像の計画・画像（上限）を回数に掛ける", opts, async () => {
  const tpl = await svc.saveArticleTemplate({ name: "画像あり", paid: false, visuals: true, maxVisuals: 3, eyecatch: true, publish: "publish" });
  const e = await svc.estimateNoteRuleConfig({ trigger: { type: "daily", times: ["09:00"] }, action: { accountId, templateId: tpl.id, topics: ["A"] } });
  assert.ok(Math.abs(e.runsPerMonth - 365 / 12) < 0.01);
  const purposes = Object.fromEntries(e.calls.map((c) => [c.purpose, c.requests]));
  assert.ok(Math.abs(purposes.article - e.runsPerMonth) < 0.01);
  assert.ok(Math.abs(purposes.review - e.runsPerMonth) < 0.01);
  assert.ok(Math.abs(purposes.visual - e.runsPerMonth) < 0.01);
  if (purposes.image_generate !== undefined) assert.ok(Math.abs(purposes.image_generate - e.runsPerMonth * 4) < 0.01);
});
