import { appendInlineQuote, canonicalStatusUrl, checkInlineQuote, INLINE_QUOTE_WEIGHT, sentences, stripQuoteUrl } from "../src/post-text";
import { test } from "node:test";
import assert from "node:assert/strict";
import { charCount, cleanPostText, formatBullets, formatPostText, removeLineBreaks, stripBrackets, xLength } from "../src/post-text";

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

test("「」は必ず取り除く。本文全体を囲む『』や引用符も外す", () => {
  assert.equal(stripBrackets("「朝の10分で集中力が変わる」"), "朝の10分で集中力が変わる");
  assert.equal(stripBrackets("今日は「ポモドーロ」を試した。「25分」だけ集中。"), "今日はポモドーロを試した。25分だけ集中。");
  assert.equal(stripBrackets("“朝活のすすめ”"), "朝活のすすめ");
  assert.equal(stripBrackets("『本A』と『本B』を読んだ"), "『本A』と『本B』を読んだ");
});

test("箇条書き: 行の途中に続いた項目を1項目ずつ改行し、前後の文と空行で分ける", () => {
  assert.equal(
    formatBullets("集中のコツは3つ。・朝日を浴びる ・水を飲む ・散歩する\nぜひ試して"),
    "集中のコツは3つ。\n\n・朝日を浴びる\n・水を飲む\n・散歩する\n\nぜひ試して"
  );
  assert.equal(formatBullets("ポイント：①睡眠②運動③食事"), "ポイント：\n\n①睡眠\n②運動\n③食事");
  // 語の間の中黒は区切らない。箇条書きでなければそのまま
  assert.equal(formatBullets("コーヒー・紅茶を控えると眠りやすい"), "コーヒー・紅茶を控えると眠りやすい");
  assert.equal(formatBullets("おはよう。\n今日も頑張ろう"), "おはよう。\n今日も頑張ろう");
});

test("箇条書きは200文字以内でも改行を残して1件、「」は取り除く", () => {
  const parts = formatPostText("「今日のToDo」\n・メール返信\n・資料作成\n・散歩", { mode: "newline", limit: 280, measure: xLength });
  assert.deepEqual(parts, ["今日のToDo\n\n・メール返信\n・資料作成\n・散歩"]);
  // 箇条書きでない短文は従来どおり改行を除く
  assert.deepEqual(formatPostText("「おはよう」\n今日も頑張ろう", { mode: "newline", limit: 280, measure: xLength }), ["おはよう今日も頑張ろう"]);
  assert.equal(cleanPostText("「見出し」\n- a\n- b", { article: true }), "見出し\n- a\n- b");
});

test("引用 URL: 正規化・本文中の重複除去・前後の半角スペース・1回だけ", () => {
  assert.equal(canonicalStatusUrl("https://twitter.com/Alice_1/status/123456789?s=20&t=x#frag"), "https://x.com/Alice_1/status/123456789");
  assert.equal(canonicalStatusUrl("https://mobile.x.com/i/web/status/123456789"), "https://x.com/i/status/123456789");
  assert.equal(canonicalStatusUrl(undefined, "123456789"), "https://x.com/i/status/123456789");
  assert.equal(canonicalStatusUrl("https://example.com/status/1"), null);
  const url = "https://x.com/a/status/123456789";
  const body = stripQuoteUrl("同意です https://x.com/a/status/123456789?s=20 本当に。\nhttps://twitter.com/a/status/123456789", "123456789");
  assert.equal(body, "同意です 本当に。");
  const t = appendInlineQuote(cleanPostText(body), url);
  assert.equal(t, `同意です 本当に。 ${url} `);
  assert.equal(checkInlineQuote(t, url), null);
  assert.match(checkInlineQuote(`前${url} `, url)!, /前に半角スペース/);
  assert.match(checkInlineQuote(` ${url}後`, url)!, /後ろに半角スペース/);
  assert.match(checkInlineQuote(` ${url} ${url} `, url)!, /2 回/);
  // 「」の除去・箇条書きの整形のあとで URL を入れるので、整形で URL やスペースが崩れない
  const bullets = appendInlineQuote(cleanPostText("「ポイント」は2つ。・朝日 ・水"), url);
  assert.equal(checkInlineQuote(bullets, url), null);
  assert.equal(xLength(` ${url} `), INLINE_QUOTE_WEIGHT);
});

test("文の分割: URL の中の ? ! では分けない", () => {
  assert.deepEqual(sentences("詳しくは https://example.com/a?b=1&c=2 を見て！次の文。"), ["詳しくは https://example.com/a?b=1&c=2 を見て！", "次の文。"]);
  const parts = formatPostText(`${"あ".repeat(130)}。詳しくは https://example.com/page?x=1!y を見て。${"い".repeat(130)}。`, { mode: "newline", limit: 280, measure: xLength });
  assert.ok(parts.some((p) => p.includes("https://example.com/page?x=1!y")));
});
