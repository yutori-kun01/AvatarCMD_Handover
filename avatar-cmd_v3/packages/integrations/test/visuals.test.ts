// 図解（アイコン・設計図の検証・描画）・記事の目印・画像生成（OpenAI / Gemini）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { findIcon, resolveIcon } from "../src/service/icons";
import { normalizeSpec, normalizeStyle, renderInfographic, renderInfographicSvg, wrap } from "../src/service/infographic";
import { imagePrompt, insertVisualMarkers, referencedMedia, splitSections } from "../src/service/article";
import { mockFetch } from "./helpers";

test("アイコン: Font Awesome / Bootstrap Icons / Lucide を名前で引き、無い名前は近いアイコンに置き換える", () => {
  assert.equal(findIcon("rocket")!.name, "fa:rocket");
  assert.equal(findIcon("fa-solid fa-rocket")!.name, "fa:rocket");
  assert.equal(findIcon("bi:lightning")!.name, "bi:lightning");
  assert.equal(findIcon("lucide:rocket")!.name, "lucide:rocket");
  assert.equal(findIcon("lucide:rocket")!.stroke, true);
  assert.equal(findIcon("no-such-icon-xyz"), null);
  assert.equal(resolveIcon("chart-something-weird").name.startsWith("fa:"), true);
  assert.equal(resolveIcon("").name, "fa:circle-info");
  assert.ok(findIcon("../../etc/passwd") === null);
});

test("図解の設計図: 文字数・要素数・数値・アイコンの問題を返し、描ける形に直す", () => {
  const ok = normalizeSpec({ type: "steps", title: "朝のルーティン", items: [{ icon: "sun", label: "日光を浴びる" }, { icon: "glass-water", label: "水を飲む" }] });
  assert.deepEqual(ok.issues, []);
  const bad = normalizeSpec({
    type: "stat" as any,
    title: "とても長いタイトルがここに入ってしまっている例です",
    items: [{ icon: "nope-nope", label: "ラベルが長すぎる場合の例です" }],
  });
  assert.ok(bad.issues.some((i) => /タイトル/.test(i)));
  assert.ok(bad.issues.some((i) => /ラベル/.test(i)));
  assert.ok(bad.issues.some((i) => /2 個以上/.test(i)));
  assert.ok(bad.issues.some((i) => /数値/.test(i)));
  assert.ok(bad.issues.some((i) => /見つからないアイコン/.test(i)));
  assert.ok([...bad.spec.title].length <= 20);
  assert.ok(bad.spec.items[0].label.endsWith("…"));
  // compare: 左右の指定が無ければ前半を左・後半を右に
  const cmp = normalizeSpec({ type: "compare", title: "比較", items: [{ icon: "a", label: "A" }, { icon: "b", label: "B" }, { icon: "c", label: "C" }, { icon: "d", label: "D" }] });
  assert.deepEqual(cmp.spec.items.map((x) => x.side), ["left", "left", "right", "right"]);
  assert.equal(normalizeSpec({ type: "unknown" as any, title: "x", items: [] }).spec.type, "steps");
});

test("図解の描画: すべての型で SVG と PNG を作れる。文字はエスケープされる", () => {
  const items = [
    { icon: "sun", label: "A<b>", value: 10, unit: "%" },
    { icon: "moon", label: "B", value: 30 },
    { icon: "star", label: "C", value: 60 },
  ];
  for (const type of ["steps", "compare", "cycle", "hierarchy", "stat", "chart", "checklist"] as const) {
    for (const chart of type === "chart" ? (["bar", "pie", "line"] as const) : ([undefined] as const)) {
      const svg = renderInfographicSvg(normalizeSpec({ type, chart, title: "テスト", items }).spec, { palette: ["#112233", "#445566"] });
      assert.match(svg, /^<svg/);
      assert.ok(!svg.includes("<b>"), `${type} でタグがエスケープされていない`);
      assert.ok(!/NaN|undefined/.test(svg), `${type}${chart ? `/${chart}` : ""} に NaN / undefined`);
    }
  }
  const r = renderInfographic({ type: "steps", title: "手順", items: items.slice(0, 2) });
  assert.deepEqual([...r.png.slice(1, 4)].map((c) => String.fromCharCode(c)).join(""), "PNG");
  assert.deepEqual(wrap("あいうえおかきくけこ", 20, 100, 2), ["あいうえお", "かきくけこ"]);
  assert.deepEqual(wrap("あいうえおかきくけこさ", 20, 100, 2), ["あいうえお", "かきくけ…"]);
  assert.equal(normalizeStyle({ palette: ["red"], corner: 999 } as any).corner, 20);
});

test("記事: 見出しで分け、計画どおりに目印を入れる。既に画像のある見出しには入れない", () => {
  const md = "# タイトル\n\n導入\n\n## 手順\n\n本文1\n\n```\n## コード内の見出しは無視\n```\n\n### 小見出し\n\n![既存](media:x.png)\n\n## まとめ\n\n本文3";
  const s = splitSections(md);
  assert.deepEqual(s.map((x) => [x.level, x.heading]), [[2, "タイトル"], [2, "手順"], [3, "小見出し"], [2, "まとめ"]]);
  const out = insertVisualMarkers(md, [
    { section: 1, kind: "infographic", description: "3つの手順 -->" },
    { section: 2, kind: "image", description: "入らない" },
    { section: 3, kind: "image", description: "達成感" },
  ]);
  assert.match(out, /## 手順\n\n<!-- infographic: 3つの手順  -->/);
  assert.doesNotMatch(out, /入らない/);
  assert.match(out, /## まとめ\n\n<!-- image: 達成感 -->/);
  const id = "0b6f5c4e-1111-4222-8333-444455556666";
  assert.deepEqual(referencedMedia(`![a](media:${id}.png)\n![b](media:${id}.png)`), [`${id}.png`]);
  const p = imagePrompt("朝の光", "本文", normalizeStyle({ mood: "やさしい", avoid: ["写真"] }));
  assert.match(p, /Do NOT include any text/);
  assert.match(p, /Mood: やさしい/);
  assert.match(p, /Avoid: 写真/);
});

// --- DB（API キーの設定・使用量の記録） --------------------------------------------

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let PNG_B64 = "";

before(async () => {
  if (!hasDb) return;
  process.env.MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "avatar-media-"));
  // 切り抜き・形式変換（sharp）を通すため、本物の PNG（1536×1024）を返す
  const sharp = (await import("sharp")).default;
  PNG_B64 = (await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#4f7cff" } }).png().toBuffer()).toString("base64");
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `visual-test-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `画像-${tag}` } })).id;
  await svc.setSetting(svc.AI_PROVIDERS.openai.keySetting, "sk-test");
  await svc.setSetting(svc.AI_PROVIDERS.gemini.keySetting, "g-test");
});

after(async () => {
  if (!hasDb) return;
  await svc.setSetting(svc.AI_PROVIDERS.openai.keySetting, null);
  await svc.setSetting(svc.AI_PROVIDERS.gemini.keySetting, null);
  await svc.saveImageSettings({ provider: null, quality: null, format: null, models: { openai: "", gemini: "" } });
  await prisma.usageLedger.deleteMany({ where: { purpose: { in: ["image_generate", "image_compare"] }, avatarId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

test("画像生成: OpenAI（参考画像なし=generations / あり=edits）と Gemini、使用量の記録、比較", opts, async () => {
  const m = mockFetch([
    ["POST", /api\.openai\.com\/v1\/images\/generations$/, { data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 50, output_tokens: 1000 } }],
    ["POST", /api\.openai\.com\/v1\/images\/edits$/, { data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 300, output_tokens: 1000 } }],
    ["POST", /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-test-image:generateContent$/, { candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 1290 } }],
  ]);
  try {
    // 既定: OpenAI・推奨モデル・品質 high・PNG（前回の実行の設定が残っていても既定から始める）
    await svc.saveImageSettings({ provider: null, quality: null, format: null, models: { openai: "", gemini: "" } });
    const d = await svc.getImageSettings();
    assert.equal(d.provider, "openai");
    assert.equal(d.models.openai, "gpt-image2.5-sunburst");
    assert.equal(d.quality, "high");
    assert.equal(d.format, "png");
    const def = await svc.generateImage({ prompt: "既定", avatarId, target: "eyecatch" });
    const sharp = (await import("sharp")).default;
    const meta = await sharp(Buffer.from(def.bytes)).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [1280, 670, "png"]);
    assert.equal(m.calls.at(-1)!.json.quality, "high");
    assert.equal(m.calls.at(-1)!.json.model, "gpt-image2.5-sunburst");

    await svc.saveImageSettings({ provider: "openai", quality: "low", format: "webp", models: { gemini: "gemini-test-image" } });
    const a = await svc.generateImage({ prompt: "朝の光", avatarId, target: "section" });
    assert.equal(a.provider, "openai");
    assert.equal(a.mimeType, "image/webp");
    const am = await sharp(Buffer.from(a.bytes)).metadata();
    assert.deepEqual([am.width, am.height, am.format], [1280, 720, "webp"]);
    const gen = m.calls.filter((c) => c.url.endsWith("/images/generations")).at(-1)!;
    assert.equal(gen.headers.authorization, "Bearer sk-test");
    assert.equal(gen.json.size, "1536x1024");
    assert.equal(gen.json.quality, "low");
    assert.equal(gen.json.output_format, "webp");

    await svc.generateImage({ prompt: "朝の光", references: [{ mimeType: "image/png", data: PNG_B64 }], avatarId });
    assert.ok(m.calls.some((c) => c.url.endsWith("/images/edits")));

    const g = await svc.generateImage({ prompt: "朝の光", provider: "gemini", aspect: "1:1", avatarId });
    assert.equal(g.mimeType, "image/webp"); // Gemini は形式を指定できないので変換する
    const gc = m.calls.find((c) => c.url.includes("generateContent"))!;
    assert.equal(gc.headers["x-goog-api-key"], "g-test");
    assert.deepEqual(gc.json.generationConfig, { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } });

    const rows = await prisma.usageLedger.findMany({ where: { avatarId, purpose: "image_generate" } });
    assert.equal(rows.length, 4);
    assert.ok(rows.some((r) => r.provider === "gemini" && r.outputTokens === 1290));

    const cmp = await svc.compareImageProviders({ prompt: "比較", avatarId });
    assert.deepEqual(cmp.map((c) => [c.provider, c.ok]).sort(), [["gemini", true], ["openai", true]]);
    assert.ok(cmp.every((c) => c.mediaName && c.ms !== undefined));
  } finally {
    m.restore();
  }
});

test("画像生成: 画像が返らない・キーが無い場合は分かるエラー。図解は AI なしで設計図から作れる", opts, async () => {
  const m = mockFetch([["POST", /generateContent$/, { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }]]);
  try {
    await assert.rejects(svc.generateImage({ prompt: "x", provider: "gemini", avatarId }), /画像が返りませんでした（SAFETY）/);
  } finally {
    m.restore();
  }
  const r = await svc.renderVisual({ avatarId, kind: "infographic", description: "手順", spec: { type: "steps", title: "手順", items: [{ icon: "sun", label: "A" }, { icon: "moon", label: "B" }] } });
  assert.match(r.media.name, /\.webp$/); // 設定の形式（webp）にそろえる
  assert.equal(r.media.alt, "手順");
  // デザイン DNA: 1 つを保存すると、イメージ画像・図解の両方に使われる
  await svc.saveAvatarStyle(avatarId, null, { palette: ["#000000", "#ffffff"], corner: 4, dna: "Flat vector, soft shapes" });
  const st = await svc.getAvatarStyles(avatarId);
  assert.equal(st.infographic.corner, 4);
  assert.equal(st.image.corner, 4);
  assert.equal(st.image.dna, "Flat vector, soft shapes");
  const prompt = svc.imagePrompt("朝", "", st.image, "eyecatch");
  assert.match(prompt, /Design DNA \(follow strictly\): Flat vector/);
  assert.match(prompt, /4px rounded corners/);
  assert.match(prompt, /1280x670/);
  await assert.rejects(svc.addStyleReference({ avatarId, kind: "video", mediaName: "x.png" }), /種類/);
});
