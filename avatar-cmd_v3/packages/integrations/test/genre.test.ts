// アバターのジャンルの自動判定（キーワード判定は単体、AI 判定・保存は実 DB + 外部 API はモック）
// DB を使うテストは AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI の使い捨て Postgres で有効。本番 DB では実行しないこと）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch } from "./helpers";
import { classifyGenreByKeywords, genreBasisHash, genreBasisText, hasGenreMaterial, isGenre } from "../src/service/genre";

const base = { name: "テスト", role: "sns_marketer", specialization: null, targetAudience: null, description: null, communication: {} };

test("ジャンル: キーワードで判定する（英字の短い語は単語として出たときだけ数える）", () => {
  assert.equal(classifyGenreByKeywords("専門: 新NISAと投資信託、家計の見直し").genre, "money");
  assert.equal(classifyGenreByKeywords("ADHD当事者。睡眠とメンタルの整え方").genre, "health");
  assert.equal(classifyGenreByKeywords("生成AIで仕事を自動化するエンジニア").genre, "tech");
  // "maintenance" の中の "ai" は数えない
  assert.equal(classifyGenreByKeywords("maintenance").genre, "other");
  assert.equal(classifyGenreByKeywords("").genre, "other");
});

test("ジャンル: 判定材料のハッシュはプロフィールが変わったときだけ変わる", () => {
  const a = { ...base, specialization: "投資" };
  assert.equal(genreBasisHash(a), genreBasisHash({ ...a }));
  assert.notEqual(genreBasisHash(a), genreBasisHash({ ...a, targetAudience: "20代" }));
  assert.notEqual(genreBasisHash(a), genreBasisHash({ ...a, communication: { topics: ["NISA"] } }));
  // 既定の役割（sns_marketer）は材料に入れない
  assert.ok(!genreBasisText(base).includes("sns_marketer"));
  assert.equal(hasGenreMaterial(base), false);
  assert.equal(hasGenreMaterial({ ...base, communication: { topics: ["料理"] } }), true);
  assert.ok(isGenre("food") && !isGenre("unknown"));
});

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
const TOUCHED = ["openai_api_key", "anthropic_api_key", "gemini_api_key", "ai_genre_provider", "ai_genre_model"];
let saved: { key: string; value: string; secret: boolean }[] = [];

function openaiText(text: string) {
  return { id: "resp_1", object: "response", model: "gpt-5-mini", output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } };
}

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  userId = (await prisma.user.create({ data: { email: `genre-${Date.now().toString(36)}@example.com` } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
});

test("ジャンル: キーが無いときはキーワードで判定し、材料が同じなら判定し直さない", opts, async () => {
  const a = await prisma.avatar.create({ data: { userId, name: "お金の先生", specialization: "新NISA・投資信託" } });
  const r = await svc.classifyAvatarGenre(a.id);
  assert.equal(r?.genre, "money");
  assert.equal(r?.meta.source, "keyword");
  assert.equal(await svc.classifyAvatarGenre(a.id), null, "材料が同じなら判定しない");
  // 材料が変わると判定し直す
  await prisma.avatar.update({ where: { id: a.id }, data: { specialization: "料理レシピ・自炊", targetAudience: "一人暮らし" } });
  assert.equal((await svc.classifyAvatarGenre(a.id))?.genre, "food");
});

test("ジャンル: AI に選択肢の中から選ばせ、手動で選んだものは上書きしない", opts, async () => {
  await svc.setSetting("openai_api_key", "sk-test");
  const m = mockFetch([["POST", /api\.openai\.com\/v1\/responses/, { ...openaiText(JSON.stringify({ genre: "education", reason: "資格・受験" })) }]]);
  try {
    const a = await prisma.avatar.create({ data: { userId, name: "合格ナビ", specialization: "資格試験の勉強法" } });
    const r = await svc.classifyAvatarGenre(a.id);
    assert.equal(r?.genre, "education");
    assert.equal(r?.meta.source, "auto");
    // 選択肢を enum で渡している
    const schema = JSON.stringify(m.calls[0].json);
    assert.ok(schema.includes('"enum"') && schema.includes('"parenting"'));

    // 手動で選ぶ → worker の判定では変わらない
    await svc.setAvatarGenre(a.id, "business");
    await prisma.avatar.update({ where: { id: a.id }, data: { description: "プロフィールを変更" } });
    await svc.processGenreClassification({ limit: 100 });
    assert.equal((await prisma.avatar.findUniqueOrThrow({ where: { id: a.id } })).genre, "business");

    // 自動に戻すと判定し直す
    const back = await svc.setAvatarGenre(a.id, null);
    assert.equal(back?.genre, "education");
    await assert.rejects(svc.setAvatarGenre(a.id, "unknown"), /ジャンルが不正/);
  } finally {
    m.restore();
    await prisma.appSetting.deleteMany({ where: { key: "openai_api_key" } });
  }
});

test("ジャンル: AI が選択肢に無い値を返したらキーワードで判定する", opts, async () => {
  await svc.setSetting("openai_api_key", "sk-test");
  const m = mockFetch([["POST", /api\.openai\.com\/v1\/responses/, { ...openaiText(JSON.stringify({ genre: "cooking", reason: "?" })) }]]);
  try {
    const a = await prisma.avatar.create({ data: { userId, name: "台所", specialization: "料理と自炊のレシピ" } });
    const r = await svc.classifyAvatarGenre(a.id);
    assert.equal(r?.genre, "food");
    assert.equal(r?.meta.source, "keyword");
  } finally {
    m.restore();
    await prisma.appSetting.deleteMany({ where: { key: "openai_api_key" } });
  }
});
