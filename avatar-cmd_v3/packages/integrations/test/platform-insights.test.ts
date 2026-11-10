// プラットフォーム × ジャンルの傾向（構成の分類・集計は単体、保存・生成への反映は実 DB）
// DB を使うテストは AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI の使い捨て Postgres で有効。本番 DB では実行しないこと）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { describeFeature, extractFeatures, jstHour } from "../src/service/post-features";
import { computeInsights, formatPlaybookForPrompt, pickHints, type InsightRow } from "../src/service/platform-insights";
import { buildPrompts } from "../src/service/ai";

const DAY = 86400_000;

test("構成の分類: 書き出し・長さ・形式・ハッシュタグ・リンク・時間帯", () => {
  // 2026-11-01 12:00 JST = 03:00 UTC
  const at = new Date("2026-11-01T03:00:00Z");
  assert.equal(jstHour(at), 12);
  const f = extractFeatures({ platform: "x", text: "朝の5分で何が変わる？\n\n・光を浴びる\n・水を飲む\n\n#朝活 #習慣", publishedAt: at });
  assert.deepEqual(f, ["hook:question", "length:short", "format:list", "hashtags:few", "link:without", "time:daytime"]);

  const g = extractFeatures({ platform: "x", text: `3つのコツを紹介します。${"あ".repeat(150)} https://example.com/a`, publishedAt: new Date("2026-11-01T14:00:00Z") });
  assert.ok(g.includes("hook:number") && g.includes("length:long") && g.includes("link:with") && g.includes("time:night"), g.join(","));
  // URL は長さに数えない
  assert.ok(extractFeatures({ platform: "x", text: `短い https://example.com/${"x".repeat(200)}` }).includes("length:short"));

  // 長文媒体: ハッシュタグは数えず、長さの区切りが違う。見出し行は書き出しにしない
  const n = extractFeatures({ platform: "note", text: `# 見出し?\n\n本文です。${"い".repeat(3500)}` });
  assert.ok(n.includes("hook:statement") && n.includes("length:long") && !n.some((x) => x.startsWith("hashtags:")) && !n.some((x) => x.startsWith("time:")), n.join(","));

  assert.deepEqual(describeFeature("hook:question"), { group: "hook", groupLabel: "書き出し", label: "問いかけで始める" });
});

/** アバター 1 体ぶん: 問いかけの投稿は表示回数が多く、言い切りは少ない */
function avatarPosts(avatarId: string, opts: { genre?: string | null; client?: string | null; n?: number; qViews?: number; sViews?: number; platform?: string } = {}): InsightRow[] {
  const n = opts.n ?? 10;
  return Array.from({ length: n }, (_, i) => {
    const q = i % 2 === 0;
    const views = q ? opts.qViews ?? 200 : opts.sViews ?? 100;
    return {
      avatarId,
      genre: opts.genre === undefined ? "health" : opts.genre,
      client: opts.client ?? null,
      platform: opts.platform ?? "x",
      text: q ? "眠れない夜、どうしてる？" : "睡眠は朝の光で整う。",
      publishedAt: new Date(Date.UTC(2026, 10, 1 + i, 3)),
      views,
      engagements: views * 0.05,
    };
  });
}

test("集計: 自分比で比べ、アバター 1 体を 1 票として 3 体以上の値だけ残す", () => {
  // 規模が 100 倍違っても、自分比なので同じ傾向として数える
  const rows = [...avatarPosts("a1", { client: "A社" }), ...avatarPosts("a2", { client: "B社", qViews: 20000, sViews: 10000 }), ...avatarPosts("a3")];
  const ins = computeInsights(rows);
  const q = ins.find((i) => i.genre === "all" && i.feature === "hook:question")!;
  // 普段（中央値）= 150 → 問いかけ (200/150 + 1)/2 ≒ 1.167
  assert.equal(q.lift, 1.167);
  assert.equal(q.agree, 1);
  assert.equal(q.avatars, 3);
  assert.equal(q.clients, 3, "A社・B社・ラベルなし");
  assert.equal(q.posts, 15);
  assert.ok(ins.find((i) => i.genre === "all" && i.feature === "hook:statement")!.lift < 1);
  // ジャンル別の集計もある
  assert.ok(ins.some((i) => i.genre === "health" && i.feature === "hook:question"));

  // 2 体だけでは残さない
  assert.equal(computeInsights([...avatarPosts("a1"), ...avatarPosts("a2")]).length, 0);
  // 普段を決めるのに投稿が足りないアバターは数えない
  assert.equal(computeInsights([...avatarPosts("a1"), ...avatarPosts("a2"), ...avatarPosts("a3", { n: 6 })]).length, 0);
  // ジャンル未判定のアバターは全ジャンルにだけ入る
  const mixed = computeInsights([...avatarPosts("a1"), ...avatarPosts("a2"), ...avatarPosts("a3", { genre: null })]);
  assert.ok(mixed.some((i) => i.genre === "all") && !mixed.some((i) => i.genre === "health"));
  // 1 件のバズは頭打ち（cap = 5）
  const buzz = [...avatarPosts("a1"), ...avatarPosts("a2"), ...avatarPosts("a3")];
  buzz[0].views = 10_000_000;
  assert.ok(computeInsights(buzz).find((i) => i.genre === "all" && i.feature === "hook:question")!.lift < 1.5);
});

test("生成に添える傾向: 分類ごとに 1 つ、ジャンルを優先、時間帯・リンクは添えない", () => {
  const rows = [
    { feature: "hook:question", lift: 1.3, genre: "all" },
    { feature: "hook:number", lift: 1.2, genre: "health" },
    { feature: "time:evening", lift: 2.0, genre: "health" },
    { feature: "link:with", lift: 1.9, genre: "all" },
    { feature: "format:list", lift: 1.25, genre: "all" },
    { feature: "length:short", lift: 1.18, genre: "all" },
    { feature: "hashtags:none", lift: 1.16, genre: "all" },
  ];
  const hints = pickHints(rows, ["health", "all"]);
  assert.deepEqual(
    hints.map((h) => h.feature),
    ["format:list", "hook:number", "length:short"]
  );
  const text = formatPlaybookForPrompt(hints);
  assert.ok(text.includes("箇条書きを使う（普段の約1.25倍）") && text.includes("口調・主張・事実は変えない"));
  assert.equal(formatPlaybookForPrompt([]), "");

  const avatar = { name: "K", role: "", description: null, specialization: null, targetAudience: null };
  assert.ok(buildPrompts(avatar, {}, { topic: "t", platform: "x" }, [], hints).system.includes("参考: このプラットフォームで反応が良い構成の傾向"));
  assert.ok(!buildPrompts(avatar, {}, { topic: "t", platform: "x" }, []).system.includes("参考: このプラットフォーム"));
});

// --- 実 DB ---------------------------------------------------------------------------------

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
const TOUCHED = ["platform_insights_computed_at", "playbook_mode"];
let saved: { key: string; value: string; secret: boolean }[] = [];
let savedInsights: Record<string, unknown>[] = [];

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  savedInsights = await prisma.platformInsight.findMany();
  userId = (await prisma.user.create({ data: { email: `insights-${Date.now().toString(36)}@example.com` } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.platformInsight.deleteMany({});
  if (savedInsights.length) await prisma.platformInsight.createMany({ data: savedInsights as never });
});

test("傾向: 指標が出そろった投稿だけで集計し、生成にはオンのときだけ添える", opts, async () => {
  const now = new Date();
  // 他のテストが残した投稿の影響を受けないよう、このテストのアバターだけの集計になっているかを件数で確かめる
  const ids: string[] = [];
  for (const [i, client] of [["1", "A社"], ["2", "B社"], ["3", null]] as const) {
    const a = await prisma.avatar.create({ data: { userId, name: `傾向-${i}`, genre: "food", clientLabel: client } });
    ids.push(a.id);
    for (const p of avatarPosts(a.id, { platform: "bluesky" })) {
      const publishedAt = new Date(now.getTime() - 20 * DAY + p.publishedAt.getUTCDate() * 3600_000);
      await prisma.content.create({
        data: {
          avatarId: a.id,
          platform: "bluesky",
          content: p.text,
          status: "PUBLISHED",
          publishedAt,
          engagement: { views: p.views, engagements: p.engagements, fetchedAt: new Date(publishedAt.getTime() + 5 * DAY).toISOString() },
        },
      });
    }
    // 指標が出そろう前（公開から 1 時間後）に取得したものは使わない
    const early = new Date(now.getTime() - 3 * DAY);
    await prisma.content.create({
      data: { avatarId: a.id, platform: "bluesky", content: "途中の値？", status: "PUBLISHED", publishedAt: early, engagement: { views: 1, engagements: 0, fetchedAt: new Date(early.getTime() + 3600_000).toISOString() } },
    });
  }
  const r = await svc.recomputePlatformInsights(now);
  assert.ok(r.insights > 0);
  const list = await svc.listPlatformInsights({ platform: "bluesky", genre: "food" });
  const q = list.find((i) => i.feature === "hook:question")!;
  assert.equal(q.avatars, 3);
  assert.equal(q.posts, 15, "出そろう前の投稿は数えない");
  assert.equal(q.label, "問いかけで始める");

  // 前回から 24 時間たっていなければ集計し直さない
  assert.equal(await svc.processPlatformInsights(new Date(now.getTime() + 3600_000)), 0);

  // 既定はオフ: 生成に添えない
  const off = await svc.loadAvatarContext(ids[0], { query: "睡眠", platform: "bluesky" });
  assert.equal(off.playbook.length, 0);
  // オン: このジャンルの傾向を添える（1.15 倍以上・6 割以上のアバターで良かったもの）
  await svc.setPlaybookMode("on");
  const on = await svc.loadAvatarContext(ids[0], { query: "睡眠", platform: "bluesky" });
  assert.ok(on.playbook.some((h) => h.feature === "hook:question" && h.genre === "food"), JSON.stringify(on.playbook));
  // 傾向はナレッジにコピーしない
  assert.equal(await prisma.knowledgeItem.count({ where: { avatarId: { in: ids } } }), 0);
  await svc.setPlaybookMode("off");
  await assert.rejects(svc.setPlaybookMode("maybe"), /on か off/);
});
