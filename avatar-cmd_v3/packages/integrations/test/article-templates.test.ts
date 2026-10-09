import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTemplate, stripVisualMarkers, templatePrompt } from "../src/service/article-templates";
import { splitPaywall } from "../src/platforms/note";

test("記事テンプレート: 価格・タグ・画像の上限を検証して整える", () => {
  const t = normalizeTemplate({ name: " ハウツー ", paid: true, price: "¥1,000" as unknown as number, tags: "#ADHD, 習慣化、ADHD" as unknown as string[], maxVisuals: 20, publish: "publish" });
  assert.equal(t.name, "ハウツー");
  assert.equal(t.price, 1000);
  assert.deepEqual(t.tags, ["ADHD", "習慣化"]);
  assert.equal(t.maxVisuals, 8);
  assert.equal(t.publish, "publish");
  assert.ok(t.id);
  assert.throws(() => normalizeTemplate({ name: "x", paid: true, price: 50 }), /100〜50,000/);
  assert.throws(() => normalizeTemplate({ name: " " }), /テンプレート名/);
  // 無料なら価格・有料ラインの位置は持たない
  const free = normalizeTemplate({ name: "無料", paid: false, price: 500, paywallHint: "途中から" });
  assert.equal(free.price, null);
  assert.equal(free.paywallHint, "");
  assert.equal(free.publish, "draft");
});

test("記事テンプレート: 構成・タイトル・有料ラインの指示を AI に渡す", () => {
  const p = templatePrompt({ structure: "## 導入\n## 手順", titleHint: "数字を入れる", paid: true, paywallHint: "手順から" });
  assert.match(p, /## 導入/);
  assert.match(p, /数字を入れる/);
  assert.match(p, /手順から/);
  assert.equal(templatePrompt({ structure: "", titleHint: "", paid: false, paywallHint: "x" }), "");
});

test("全自動: 作れなかった画像・図解の目印は消し、有料ラインは残す", () => {
  const md = "## A\n\n<!-- image: 朝 -->\n\n本文\n\n<!-- paywall -->\n\n<!-- infographic: 手順 -->\n\n続き";
  const out = stripVisualMarkers(md);
  assert.doesNotMatch(out, /image:|infographic:/);
  assert.match(out, /<!-- paywall -->/);
  assert.doesNotMatch(out, /\n{3,}/);
});

test("note: 有料ラインの要素で本文を無料部分と有料部分に分ける", () => {
  const html = '<p name="a" id="a">無料</p><h2 name="b" id="b">有料の見出し</h2><p name="c" id="c">続き</p>';
  assert.deepEqual(splitPaywall(html, "b"), { free: '<p name="a" id="a">無料</p>', pay: '<h2 name="b" id="b">有料の見出し</h2><p name="c" id="c">続き</p>' });
  assert.deepEqual(splitPaywall(html, undefined), { free: html, pay: "" });
  assert.deepEqual(splitPaywall(html, "zzz"), { free: html, pay: "" });
});
