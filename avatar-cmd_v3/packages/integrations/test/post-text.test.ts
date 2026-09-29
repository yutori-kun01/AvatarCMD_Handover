import { test } from "node:test";
import assert from "node:assert/strict";
import { charCount, formatPostText, removeLineBreaks, xLength } from "../src/post-text";

const ja = (n: number) => "あ".repeat(n);

test("X の文字数: 日本語は2、英数字は1、URL は23", () => {
  assert.equal(xLength("abc"), 3);
  assert.equal(xLength("あいう"), 6);
  assert.equal(xLength("見て https://example.com/very/long/path/xxxxxxxxxxxxxxxxxxxxxxxx"), 4 + 1 + 23);
});

test("改行の除去: 日本語はそのままつなぎ、英数字どうしは空白でつなぐ", () => {
  assert.equal(removeLineBreaks("おはよう。\n\n今日は晴れ。\nhttps://a.example"), "おはよう。今日は晴れ。 https://a.example");
  assert.equal(removeLineBreaks("Hello\nworld"), "Hello world");
});

test("200文字以内は改行なしで1件", () => {
  const text = `${ja(50)}。\n\n${ja(50)}。`;
  const threads = formatPostText(text, { mode: "thread", limit: 500, measure: charCount });
  assert.deepEqual(threads, [`${ja(50)}。${ja(50)}。`]);
});

test("200文字超 + 改行あり: 改行を残して1件", () => {
  const text = `${ja(150)}。\n\n${ja(150)}。`;
  assert.deepEqual(formatPostText(text, { mode: "newline", limit: 500, measure: charCount }), [text]);
});

test("200文字超 + ツリー: 段落ごとに200文字以内で分ける", () => {
  const text = `${ja(150)}。\n\n${ja(150)}。\n${ja(30)}。`;
  const parts = formatPostText(text, { mode: "thread", limit: 500, measure: charCount });
  assert.deepEqual(parts, [`${ja(150)}。`, `${ja(150)}。\n${ja(30)}。`]);
  for (const p of parts) assert.ok(charCount(p) <= 200);
});

test("長い1文は文の区切り、それでも長ければ文字単位で分ける", () => {
  const text = `${ja(120)}。${ja(120)}。${ja(450)}`;
  const parts = formatPostText(text, { mode: "thread", limit: 500, measure: charCount });
  assert.equal(parts.join(""), text);
  for (const p of parts) assert.ok(charCount(p) <= 200, `${charCount(p)}`);
});

test("X（Premium なし）: 改行ありでも 280 を超えるなら自動でツリーに分ける", () => {
  // 日本語180文字 = 360 > 280。200文字以内なので改行は取り除かれる
  const parts = formatPostText(`${ja(90)}。\n${ja(89)}。`, { mode: "newline", limit: 280, measure: xLength });
  assert.equal(parts.length, 2);
  for (const p of parts) assert.ok(xLength(p) <= 280);
  assert.ok(!parts.some((p) => p.includes("\n")));
});

test("URL は途中で切らない", () => {
  const url = "https://example.com/abc";
  const parts = formatPostText(`${ja(139)}${url}`, { mode: "newline", limit: 280, measure: xLength });
  assert.ok(parts.some((p) => p.includes(url)));
});
