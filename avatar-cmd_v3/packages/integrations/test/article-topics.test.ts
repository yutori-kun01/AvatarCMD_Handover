// note 記事のテーマ候補: 重複の判定（純粋関数）と、提案 → キュー → 記事ルールでの使用の結合テスト（実 DB + AI はモック）
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";
import { dedupeTopics, topicSimilarity } from "../src/service/article-topics";

test("重複の判定: 言い換え程度の近いテーマは捨て、違うテーマは残す", () => {
  assert.ok(topicSimilarity("ADHD でも続く朝の集中ルーティン", "ADHDでも続く朝の集中ルーティン術") >= 0.5);
  assert.ok(topicSimilarity("先延ばしを減らす 3 つの仕組み", "睡眠の質を上げる夜の習慣") < 0.2);
  assert.deepEqual(dedupeTopics(["朝の集中ルーティン", "朝の集中ルーティン入門", "睡眠の質を上げる夜の習慣", " "], ["朝の集中ルーティン"]), ["睡眠の質を上げる夜の習慣"]);
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
const TOUCHED = ["anthropic_api_key", "ai_post_provider", "article_templates", "worker_heartbeat"];
let saved: { key: string; value: string; secret: boolean }[] = [];
let suggestions: { topic: string; reason: string; source: string }[] = [];

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `article-topics-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `テーマテスト-${tag}`, communication: { topics: ["集中"] } } })).id;
  accountId = (await svc.saveConnectedAccount(avatarId, "note", { accountId: `t${tag}`, accountName: "note-t", credentials: { cookie: "c" } })).id;
  await svc.setSetting("anthropic_api_key", "ak-test");
  await svc.setSetting(svc.SETTING_KEYS.workerHeartbeat, new Date().toISOString());
  templateId = (await svc.saveArticleTemplate({ name: "無料", visuals: false, eyecatch: false })).id;
});

beforeEach(async () => {
  if (!hasDb) return;
  await prisma.automationRule.deleteMany({ where: { avatarId } });
  await prisma.content.deleteMany({ where: { avatarId } });
  await prisma.articleJob.deleteMany({ where: { avatarId } });
});

after(async () => {
  if (!hasDb) return;
  await prisma.articleJob.deleteMany({ where: { avatarId } });
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.$disconnect();
});

function mocks() {
  return mockFetch([
    ["POST", /api\.anthropic\.com\/v1\/messages/, (c) => ({ text: claudeSse(c.json.model, JSON.stringify({ suggestions })), headers: { "content-type": "text/event-stream" } })],
  ]);
}

const rule = (autoTopics: string, topics: string[] = []) =>
  svc.createRule({ avatarId, name: `テーマ ${autoTopics}`, actionType: "note_article", trigger: { type: "interval", hours: 24 }, action: { accountId, templateId, topics, autoTopics } as any });

test("提案: 過去の記事・ルールのテーマと重複する候補は除き、suggest では提案のまま（採用待ち）", opts, async () => {
  const r = await rule("suggest", ["朝の集中ルーティン"]);
  await prisma.content.create({ data: { avatarId, platform: "note", snsAccountId: accountId, content: "x", status: "PUBLISHED", category: "automation", metadata: { topic: "睡眠の質を上げる夜の習慣" } } });
  suggestions = [
    { topic: "朝の集中ルーティン入門", reason: "r", source: "persona" },
    { topic: "睡眠の質を上げる夜の習慣", reason: "r", source: "knowledge" },
    { topic: "先延ばしを減らす 3 つの仕組み", reason: "反応が良かった投稿の深掘り", source: "sns" },
  ];
  const m = mocks();
  try {
    assert.equal(await svc.suggestArticleTopics(r.id), 1);
  } finally {
    m.restore();
  }
  const list = await svc.listTopicSuggestions({ ruleId: r.id });
  assert.deepEqual(list.map((s) => [s.topic, s.status, s.source]), [["先延ばしを減らす 3 つの仕組み", "proposed", "sns"]]);
  // 採用前は使わない（ルールのテーマを使う）→ 採用すると次の記事のテーマになり、使用済みになる
  await svc.runRule(r.id);
  assert.equal(((await prisma.articleJob.findFirstOrThrow({ where: { avatarId }, orderBy: { createdAt: "desc" } })).input as any).topic, "朝の集中ルーティン");
  await svc.updateTopicSuggestion(list[0].id, { status: "accepted" });
  await svc.runRule(r.id);
  assert.equal(((await prisma.articleJob.findFirstOrThrow({ where: { avatarId }, orderBy: { createdAt: "desc" } })).input as any).topic, "先延ばしを減らす 3 つの仕組み");
  assert.equal((await prisma.articleTopicSuggestion.findUniqueOrThrow({ where: { id: list[0].id } })).status, "used");
});

test("全自動: テーマが空でもルールを作れ、提案をそのまま使う。候補が無ければエラー。補充は少ないときだけ 1 日 1 回", opts, async () => {
  const r = await rule("auto");
  await assert.rejects(svc.runRule(r.id), /テーマ候補がありません/);
  suggestions = [
    { topic: "集中が続かない人のための机の整え方", reason: "r", source: "knowledge" },
    { topic: "やる気に頼らないタスク管理", reason: "r", source: "persona" },
  ];
  const m = mocks();
  try {
    assert.equal(await svc.processTopicSuggestions(), 1);
    // 直後はまだ 2 件（3 件未満）だが、1 日以内なので補充しない
    assert.equal(await svc.processTopicSuggestions(), 0);
  } finally {
    m.restore();
  }
  const list = await svc.listTopicSuggestions({ ruleId: r.id });
  assert.ok(list.every((s) => s.status === "accepted"));
  await svc.updateTopicSuggestion(list[1].id, { toTop: true });
  await svc.runRule(r.id);
  assert.equal(((await prisma.articleJob.findFirstOrThrow({ where: { avatarId }, orderBy: { createdAt: "desc" } })).input as any).topic, "やる気に頼らないタスク管理");
  const cal = (await svc.articleCalendar({ avatarIds: [avatarId], days: 3 })).filter((i) => i.kind === "creation");
  assert.equal(cal[0]?.title, "集中が続かない人のための机の整え方");
});
