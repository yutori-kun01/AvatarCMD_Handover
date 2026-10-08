import { checkInlineQuote, xLength } from "../src/post-text";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS } from "../src/platforms";
import { escapeLittleText } from "../src/platforms/linkedin";
import { tiktokChunks } from "../src/platforms/tiktok";
import { zennTopics } from "../src/platforms/zenn";
import { notePrice } from "../src/platforms/note";
import { markdownToNote } from "../src/markdown";
import { ctx, media, mockFetch, system } from "./helpers";

const post = (p: Partial<import("../src/types").PostInput> = {}) => ({ text: "hello", media: [], options: {}, ...p });

test("X: 認可URLは x.com/i/oauth2/authorize + PKCE S256 + media.write", () => {
  const url = new URL(PLATFORMS.x.oauth!.authorizeUrl({ clientId: "cid" }, { redirectUri: "https://r/cb", state: "st", codeChallenge: "cc", system }));
  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("scope")!, /tweet\.write.*media\.write.*offline\.access/);
});

test("X: トークン交換は api.x.com + Basic 認証、users/me でアカウント取得", async () => {
  const m = mockFetch([
    ["POST", /api\.x\.com\/2\/oauth2\/token$/, { access_token: "AT", refresh_token: "RT", expires_in: 7200, scope: "tweet.write" }],
    ["GET", /api\.x\.com\/2\/users\/me$/, { data: { id: "42", username: "sample_user" } }],
  ]);
  try {
    const [acc] = await PLATFORMS.x.oauth!.exchangeCode({ clientId: "cid", clientSecret: "sec" }, { code: "C", redirectUri: "https://r/cb", codeVerifier: "V", system });
    assert.equal(m.calls[0].headers.authorization, `Basic ${Buffer.from("cid:sec").toString("base64")}`);
    assert.equal(m.calls[0].form!.code_verifier, "V");
    assert.equal(acc.accountId, "42");
    assert.equal(acc.credentials.refreshToken, "RT");
    assert.ok(acc.credentials.expiresAt);
  } finally {
    m.restore();
  }
});

test("X: 画像は /2/media/upload、投稿は /2/tweets に media_ids 付き", async () => {
  const m = mockFetch([
    ["POST", /\/2\/media\/upload$/, { data: { id: "M1" } }],
    ["POST", /\/2\/tweets$/, { data: { id: "T1" } }],
  ]);
  try {
    const r = await PLATFORMS.x.publish!(ctx({ credentials: { accessToken: "AT", username: "sample_user" } }), post({ media: [media("image/png")] }));
    assert.equal(m.calls[0].json.media_category, "tweet_image");
    assert.ok(typeof m.calls[0].json.media === "string");
    assert.deepEqual(m.calls[1].json, { text: "hello", media: { media_ids: ["M1"] } });
    assert.equal(m.calls[1].headers.authorization, "Bearer AT");
    assert.equal(r.url, "https://x.com/sample_user/status/T1");
  } finally {
    m.restore();
  }
});

test("X: 動画は initialize → append → finalize → STATUS 待ち", async () => {
  let status = 0;
  const m = mockFetch([
    ["POST", /\/2\/media\/upload\/initialize$/, { data: { id: "V1" } }],
    ["POST", /\/2\/media\/upload\/V1\/append$/, {}],
    ["POST", /\/2\/media\/upload\/V1\/finalize$/, { data: { id: "V1", processing_info: { state: "pending" } } }],
    ["GET", /\/2\/media\/upload\?command=STATUS/, () => ({ json: { data: { processing_info: { state: status++ ? "succeeded" : "in_progress" } } } })],
    ["POST", /\/2\/tweets$/, { data: { id: "T2" } }],
  ]);
  try {
    await PLATFORMS.x.publish!(ctx(), post({ media: [media("video/mp4", 5 * 1024 * 1024)] }));
    const paths = m.calls.map((c) => c.method + " " + new URL(c.url).pathname);
    assert.deepEqual(paths.slice(0, 5), [
      "POST /2/media/upload/initialize",
      "POST /2/media/upload/V1/append",
      "POST /2/media/upload/V1/append",
      "POST /2/media/upload/V1/append",
      "POST /2/media/upload/V1/finalize",
    ]);
    assert.equal(m.calls[0].json.total_bytes, 5 * 1024 * 1024);
    assert.equal(m.calls[0].json.media_category, "tweet_video");
    assert.equal(m.calls[3].json.segment_index, 2);
  } finally {
    m.restore();
  }
});

test("X: 期限5分前ならリフレッシュし、ローテーションされたトークンを保存", async () => {
  const m = mockFetch([["POST", /oauth2\/token$/, { access_token: "NEW", refresh_token: "RT2", expires_in: 7200 }]]);
  try {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const r = await PLATFORMS.x.refresh!({ clientId: "c" }, { accessToken: "OLD", refreshToken: "RT", expiresAt: soon }, system);
    assert.equal(r!.accessToken, "NEW");
    assert.equal(r!.refreshToken, "RT2");
    assert.equal(m.calls[0].form!.client_id, "c"); // public client
    const later = new Date(Date.now() + 3600_000).toISOString();
    assert.equal(await PLATFORMS.x.refresh!({ clientId: "c" }, { accessToken: "A", refreshToken: "R", expiresAt: later }, system), null);
  } finally {
    m.restore();
  }
});

test("X: 引用は最初から元投稿の URL を本文に入れて投稿する（quote_tweet_id は送らない・URL の前後に半角スペース）", async () => {
  const m = mockFetch([["POST", /api\.x\.com\/2\/tweets$/, { data: { id: "T2" } }]]);
  try {
    const r = await PLATFORMS.x.publish!(
      ctx({ credentials: { accessToken: "AT", username: "me" } }),
      post({ text: "わかる。朝に場所を変えると集中が戻る https://twitter.com/someone/status/1234567890?s=20", quotePostId: "1234567890", quotePostUrl: "https://twitter.com/someone/status/1234567890?s=20" })
    );
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].json.quote_tweet_id, undefined);
    // 本文中の重複した URL は除き、正規化した URL を1回だけ、前後に半角スペースを入れて付ける
    assert.equal(m.calls[0].json.text, "わかる。朝に場所を変えると集中が戻る https://x.com/someone/status/1234567890 ");
    assert.equal(r.postId, "T2");
  } finally {
    m.restore();
  }
});

test("X: 引用 URL 付きの長文はツリーに分け、URL は1件目に1回だけ（分割されない）", async () => {
  let n = 0;
  const m = mockFetch([["POST", /\/2\/tweets$/, () => ({ json: { data: { id: `T${++n}` } } })]]);
  try {
    const text = `・朝日を浴びる\n・水を飲む\n${"あ".repeat(150)}。${"い".repeat(150)}？`;
    await PLATFORMS.x.publish!(ctx({ credentials: { accessToken: "AT", username: "me" }, settings: { longPostMode: "thread" } }), post({ text, quotePostId: "99999", quotePostUrl: "https://x.com/a/status/99999" }));
    const url = "https://x.com/a/status/99999";
    const texts = m.calls.map((c) => c.json.text as string);
    assert.ok(texts.length >= 2);
    assert.equal(texts.filter((t) => t.includes(url)).length, 1);
    assert.equal(checkInlineQuote(texts[0], url), null);
    assert.ok(texts.every((t) => xLength(t) <= 280));
  } finally {
    m.restore();
  }
});

test("X: 長文はツリー設定なら返信でつなげて投稿し、メディアは1件目だけ", async () => {
  let n = 0;
  const m = mockFetch([
    ["POST", /\/2\/media\/upload$/, { data: { id: "M1" } }],
    ["POST", /\/2\/tweets$/, () => ({ json: { data: { id: `T${++n}` } } })],
  ]);
  try {
    const text = `${"あ".repeat(120)}。\n\n${"い".repeat(120)}。`;
    const r = await PLATFORMS.x.publish!(
      ctx({ credentials: { accessToken: "AT", username: "me" }, settings: { longPostMode: "thread" } }),
      post({ text, media: [media("image/png")] })
    );
    const tweets = m.calls.filter((c) => c.url.endsWith("/2/tweets"));
    assert.equal(tweets.length, 2);
    assert.deepEqual(tweets[0].json, { text: `${"あ".repeat(120)}。`, media: { media_ids: ["M1"] } });
    assert.deepEqual(tweets[1].json, { text: `${"い".repeat(120)}。`, reply: { in_reply_to_tweet_id: "T1" } });
    assert.equal(r.postId, "T1");
    assert.match(r.note!, /ツリー投稿（2件）/);
  } finally {
    m.restore();
  }
});

test("X: 200文字以内は改行を取り除いて1件", async () => {
  const m = mockFetch([["POST", /\/2\/tweets$/, { data: { id: "T1" } }]]);
  try {
    await PLATFORMS.x.publish!(ctx({ settings: { premium: "on" } }), post({ text: "おはよう。\n\n今日も頑張ろう。", link: "https://example.com" }));
    assert.deepEqual(m.calls[0].json, { text: "おはよう。今日も頑張ろう。 https://example.com" });
  } finally {
    m.restore();
  }
});

test("X: 2件目以降が失敗しても1件目は投稿済みとして返す（再試行で重複させない）", async () => {
  let n = 0;
  const m = mockFetch([["POST", /\/2\/tweets$/, () => (n++ === 0 ? { json: { data: { id: "T1" } } } : { status: 503, text: "down" })]]);
  try {
    const r = await PLATFORMS.x.publish!(ctx({ settings: { longPostMode: "thread", premium: "on" } }), post({ text: `${"あ".repeat(150)}。\n${"い".repeat(150)}。` }));
    assert.equal(r.postId, "T1");
    assert.match(r.note!, /2\/2 件目以降の投稿に失敗/);
  } finally {
    m.restore();
  }
});

test("X: 402 はクレジット不足の設定エラー、401 は再接続を促す", async () => {
  for (const [status, re] of [[402, /クレジット/], [401, /再接続/]] as const) {
    const m = mockFetch([["POST", /\/2\/tweets$/, () => ({ status, json: { title: "err" } })]]);
    try {
      await assert.rejects(PLATFORMS.x.publish!(ctx(), post()), (e: Error) => e.name === "ConfigError" && re.test(e.message));
    } finally {
      m.restore();
    }
  }
});

test("Threads: 長文はツリー設定なら reply_to_id でつなげて投稿", async () => {
  let c = 0;
  let p = 0;
  const m = mockFetch([
    ["POST", /graph\.threads\.net\/v1\.0\/U1\/threads$/, () => ({ json: { id: `C${++c}` } })],
    ["GET", /graph\.threads\.net\/v1\.0\/C\d\?/, { status: "FINISHED" }],
    ["POST", /graph\.threads\.net\/v1\.0\/U1\/threads_publish$/, () => ({ json: { id: `P${++p}` } })],
    ["GET", /graph\.threads\.net\/v1\.0\/P1\?/, { permalink: "https://www.threads.com/@me/post/x" }],
  ]);
  try {
    const text = `${"あ".repeat(150)}。\n${"い".repeat(150)}。`;
    const r = await PLATFORMS.threads.publish!(ctx({ credentials: { accessToken: "AT", userId: "U1" }, settings: { longPostMode: "thread" } }), post({ text }));
    const containers = m.calls.filter((x) => x.method === "POST" && x.url.endsWith("/U1/threads"));
    assert.equal(containers.length, 2);
    assert.equal(containers[0].form!.text, `${"あ".repeat(150)}。`);
    assert.equal(containers[0].form!.reply_to_id, undefined);
    assert.equal(containers[1].form!.text, `${"い".repeat(150)}。`);
    assert.equal(containers[1].form!.reply_to_id, "P1");
    assert.equal(r.postId, "P1");
    assert.equal(r.url, "https://www.threads.com/@me/post/x");
  } finally {
    m.restore();
  }
});

test("Threads: TEXT コンテナ作成 → threads_publish", async () => {
  const m = mockFetch([
    ["POST", /graph\.threads\.net\/v1\.0\/U1\/threads$/, { id: "C1" }],
    ["GET", /graph\.threads\.net\/v1\.0\/C1\?/, { status: "FINISHED" }],
    ["POST", /graph\.threads\.net\/v1\.0\/U1\/threads_publish$/, { id: "P1" }],
    ["GET", /graph\.threads\.net\/v1\.0\/P1\?/, { permalink: "https://www.threads.com/@me/post/x" }],
  ]);
  try {
    const r = await PLATFORMS.threads.publish!(ctx({ credentials: { accessToken: "AT", userId: "U1" } }), post());
    assert.deepEqual(m.calls[0].form, { media_type: "TEXT", text: "hello", access_token: "AT" });
    assert.equal(m.calls[2].form!.creation_id, "C1");
    assert.equal(r.url, "https://www.threads.com/@me/post/x");
  } finally {
    m.restore();
  }
});

test("Threads: 公開時の「メディアが見つかりません」(4279009) は待って再試行する", async () => {
  let n = 0;
  const notFound = { status: 400, json: { error: { message: "The requested resource does not exist", code: 24, error_subcode: 4279009 } } };
  const m = mockFetch([
    ["POST", /graph\.threads\.net\/v1\.0\/U1\/threads$/, { id: "C1" }],
    ["GET", /graph\.threads\.net\/v1\.0\/C1\?/, { status: "FINISHED" }],
    ["POST", /graph\.threads\.net\/v1\.0\/U1\/threads_publish$/, () => (n++ === 0 ? notFound : { json: { id: "P1" } })],
    ["GET", /graph\.threads\.net\/v1\.0\/P1\?/, { permalink: "https://www.threads.com/@me/post/x" }],
  ]);
  try {
    const r = await PLATFORMS.threads.publish!(ctx({ credentials: { accessToken: "AT", userId: "U1" } }), post());
    assert.equal(n, 2);
    assert.equal(r.postId, "P1");
  } finally {
    m.restore();
  }
});

test("Threads: 認可コード → 短期 → 長期トークン (th_exchange_token)", async () => {
  const m = mockFetch([
    ["POST", /graph\.threads\.net\/oauth\/access_token$/, { access_token: "S", user_id: 1 }],
    ["GET", /graph\.threads\.net\/access_token\?grant_type=th_exchange_token/, { access_token: "L", expires_in: 5184000 }],
    ["GET", /graph\.threads\.net\/v1\.0\/me\?/, { id: "U1", username: "me" }],
  ]);
  try {
    const [acc] = await PLATFORMS.threads.oauth!.exchangeCode({ appId: "a", appSecret: "s" }, { code: "C", redirectUri: "https://r", system });
    assert.equal(acc.credentials.accessToken, "L");
    assert.equal(acc.credentials.userId, "U1");
  } finally {
    m.restore();
  }
});

test("Instagram: 画像1枚は image_url コンテナ → status_code 待ち → media_publish (v26.0)", async () => {
  let n = 0;
  const m = mockFetch([
    ["POST", /graph\.instagram\.com\/v26\.0\/IG\/media$/, { id: "C1" }],
    ["GET", /graph\.instagram\.com\/v26\.0\/C1\?/, () => ({ json: { status_code: n++ ? "FINISHED" : "IN_PROGRESS" } })],
    ["POST", /graph\.instagram\.com\/v26\.0\/IG\/media_publish$/, { id: "M1" }],
    ["GET", /graph\.instagram\.com\/v26\.0\/M1\?/, { permalink: "https://www.instagram.com/p/abc/" }],
  ]);
  try {
    const r = await PLATFORMS.instagram.publish!(ctx({ credentials: { accessToken: "AT", userId: "IG" } }), post({ media: [media("image/jpeg")] }));
    assert.equal(m.calls[0].form!.image_url, "https://cmd.example.com/media/a.jpeg");
    assert.equal(m.calls[0].form!.caption, "hello");
    assert.equal(r.url, "https://www.instagram.com/p/abc/");
  } finally {
    m.restore();
  }
});

test("Instagram: 添付なしは設定エラー", async () => {
  await assert.rejects(PLATFORMS.instagram.publish!(ctx({ credentials: { accessToken: "AT", userId: "IG" } }), post()), /添付/);
});

test("Facebook: 接続でページごとにアカウントを返す", async () => {
  const m = mockFetch([
    ["GET", /graph\.facebook\.com\/v26\.0\/oauth\/access_token\?client_id/, { access_token: "S" }],
    ["GET", /graph\.facebook\.com\/v26\.0\/oauth\/access_token\?grant_type=fb_exchange_token/, { access_token: "L" }],
    ["GET", /\/me\/accounts\?/, { data: [{ id: "P1", name: "Page1", access_token: "PT1" }, { id: "P2", name: "Page2", access_token: "PT2" }] }],
  ]);
  try {
    const accs = await PLATFORMS.facebook.oauth!.exchangeCode({ appId: "a", appSecret: "s" }, { code: "C", redirectUri: "https://r", system });
    assert.deepEqual(accs.map((a) => [a.accountId, a.credentials.accessToken]), [["P1", "PT1"], ["P2", "PT2"]]);
  } finally {
    m.restore();
  }
});

test("Facebook: テキストは /{page}/feed", async () => {
  const m = mockFetch([["POST", /\/v26\.0\/P1\/feed$/, { id: "P1_9" }]]);
  try {
    const r = await PLATFORMS.facebook.publish!(ctx({ credentials: { accessToken: "PT", pageId: "P1" } }), post({ link: "https://ex.com" }));
    assert.equal(m.calls[0].form!.message, "hello");
    assert.equal(m.calls[0].form!.link, "https://ex.com");
    assert.equal(r.postId, "P1_9");
  } finally {
    m.restore();
  }
});

test("YouTube: resumable 開始 → Location に PUT", async () => {
  const m = mockFetch([
    ["POST", /upload\/youtube\/v3\/videos/, () => ({ json: {}, headers: { location: "https://upload.example/u1" } })],
    ["PUT", /upload\.example\/u1$/, { id: "VID" }],
  ]);
  try {
    const r = await PLATFORMS.youtube.publish!(
      ctx({ settings: { privacyStatus: "unlisted", categoryId: "27" } }),
      post({ text: "説明文", options: { title: "タイトル" }, media: [media("video/mp4", 100)] })
    );
    assert.equal(m.calls[0].headers["x-upload-content-length"], "100");
    assert.equal(m.calls[0].json.snippet.title, "タイトル");
    assert.equal(m.calls[0].json.status.privacyStatus, "unlisted");
    assert.equal(m.calls[1].method, "PUT");
    assert.equal(r.url, "https://www.youtube.com/watch?v=VID");
  } finally {
    m.restore();
  }
});

test("LinkedIn: /rest/posts に LinkedIn-Version ヘッダ、commentary はエスケープ", async () => {
  const m = mockFetch([["POST", /api\.linkedin\.com\/rest\/posts$/, () => ({ status: 201, text: "", headers: { "x-restli-id": "urn:li:share:1" } })]]);
  try {
    const r = await PLATFORMS.linkedin.publish!(ctx({ credentials: { accessToken: "AT", personUrn: "urn:li:person:abc" } }), post({ text: "Hi #tag (x)" }));
    const c = m.calls[0];
    assert.equal(c.headers["linkedin-version"], "202604");
    assert.equal(c.headers["x-restli-protocol-version"], "2.0.0");
    assert.equal(c.json.author, "urn:li:person:abc");
    assert.equal(c.json.commentary, "Hi \\#tag \\(x\\)");
    assert.equal(c.json.distribution.feedDistribution, "MAIN_FEED");
    assert.equal(r.url, "https://www.linkedin.com/feed/update/urn:li:share:1/");
  } finally {
    m.restore();
  }
  assert.equal(escapeLittleText("a_b*c"), "a\\_b\\*c");
});

test("Reddit: /api/submit に self 投稿、User-Agent 必須", async () => {
  const m = mockFetch([["POST", /oauth\.reddit\.com\/api\/submit$/, { json: { errors: [], data: { name: "t3_x", url: "https://reddit.com/r/test/x" } } }]]);
  try {
    const r = await PLATFORMS.reddit.publish!(ctx({ app: { userAgent: "ua" }, settings: { subreddit: "test" } }), post({ options: { title: "T" } }));
    assert.deepEqual(m.calls[0].form, { api_type: "json", kind: "self", sr: "test", title: "T", text: "hello" });
    assert.equal(m.calls[0].headers["user-agent"], "ua");
    assert.equal(r.postId, "t3_x");
  } finally {
    m.restore();
  }
  await assert.rejects(PLATFORMS.reddit.publish!(ctx(), post()), /subreddit/);
});

test("TikTok: creator_info → video/init(FILE_UPLOAD) → PUT → status/fetch", async () => {
  const m = mockFetch([
    ["POST", /creator_info\/query\/$/, { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }],
    ["POST", /post\/publish\/video\/init\/$/, { data: { publish_id: "PUB", upload_url: "https://up.tiktok/x" }, error: { code: "ok" } }],
    ["PUT", /up\.tiktok\/x$/, {}],
    ["POST", /status\/fetch\/$/, { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [777] }, error: { code: "ok" } }],
  ]);
  try {
    const r = await PLATFORMS.tiktok.publish!(
      ctx({ settings: { privacyLevel: "SELF_ONLY" }, account: { accountId: "o", accountName: "@me" } }),
      post({ media: [media("video/mp4", 1000)] })
    );
    const init = m.calls[1].json;
    assert.equal(init.source_info.source, "FILE_UPLOAD");
    assert.equal(init.source_info.video_size, 1000);
    assert.equal(init.post_info.privacy_level, "SELF_ONLY");
    assert.equal(m.calls[2].headers["content-range"], "bytes 0-999/1000");
    assert.equal(r.url, "https://www.tiktok.com/@me/video/777");
  } finally {
    m.restore();
  }
  await assert.rejects(PLATFORMS.tiktok.publish!(ctx(), post({ media: [media("video/mp4")] })), /公開範囲/);
  const MB = 1024 * 1024;
  assert.deepEqual(tiktokChunks(3 * MB), { chunkSize: 3 * MB, count: 1 });
  assert.deepEqual(tiktokChunks(25 * MB), { chunkSize: 10 * MB, count: 2 });
});

test("WordPress: Basic 認証で /wp/v2/posts、Markdown は HTML 化", async () => {
  const m = mockFetch([["POST", /example\.com\/wp-json\/wp\/v2\/posts$/, { id: 5, link: "https://example.com/?p=5" }]]);
  try {
    const r = await PLATFORMS.wordpress.publish!(
      ctx({ credentials: { siteUrl: "https://example.com/", username: "u", appPassword: "p w" }, settings: { status: "draft" } }),
      post({ text: "# 見出し\n\n**太字**です", options: { title: "記事" } })
    );
    const c = m.calls[0];
    assert.equal(c.headers.authorization, `Basic ${Buffer.from("u:p w").toString("base64")}`);
    assert.equal(c.json.status, "draft");
    assert.match(c.json.content, /<h2>見出し<\/h2>/);
    assert.match(c.json.content, /<strong>太字<\/strong>/);
    assert.equal(r.url, "https://example.com/?p=5");
  } finally {
    m.restore();
  }
});

test("Zenn: GitHub Contents API に articles/<slug>.md を PUT（front matter 付き）", async () => {
  const m = mockFetch([["PUT", /api\.github\.com\/repos\/me\/zenn\/contents\/articles\/[a-f0-9]{14}\.md$/, { content: {} }]]);
  try {
    const r = await PLATFORMS.zenn.publish!(
      ctx({ credentials: { repo: "me/zenn", branch: "main", token: "ghp", zennUsername: "me" }, settings: { published: "false", type: "tech", emoji: "🐙" } }),
      post({ text: "本文", options: { title: 'タイトル"引用"' }, tags: ["TypeScript", "Next.js"] })
    );
    const c = m.calls[0];
    const md = Buffer.from(c.json.content, "base64").toString();
    assert.match(md, /^---\ntitle: "タイトル\\"引用\\""\nemoji: "🐙"\ntype: "tech"\ntopics: \["typescript", "nextjs"\]\npublished: false\n---\n/);
    assert.equal(c.json.branch, "main");
    assert.match(r.url!, /^https:\/\/zenn\.dev\/me\/articles\/[a-f0-9]{14}$/);
  } finally {
    m.restore();
  }
  assert.deepEqual(zennTopics(["A", "b", "c", "d", "e", "f"]), ["a", "b", "c", "d", "e"]);
});

test("note: text_notes 作成 → draft_save（下書きのみ）", async () => {
  const m = mockFetch([
    ["POST", /note\.com\/api\/v1\/text_notes$/, { data: { id: 1, key: "nabc" } }],
    ["POST", /note\.com\/api\/v1\/text_notes\/draft_save\?id=1$/, { data: {} }],
  ]);
  try {
    const r = await PLATFORMS.note.publish!(ctx({ credentials: { cookie: "_note_session_v5=S" } }), post({ text: "# T\n\n本文", tags: ["AI"] }));
    assert.equal(m.calls[0].headers.cookie, "_note_session_v5=S");
    assert.equal(m.calls[1].json.status, "draft");
    assert.equal(m.calls[1].json.name, "T");
    assert.deepEqual(m.calls[1].json.hashtag_notes, [{ hashtag: { name: "AI" } }]);
    assert.equal(r.url, "https://note.com/notes/nabc/edit");
  } finally {
    m.restore();
  }
});

test("note: 画像・見出し画像・有料ライン・価格・タグまで下書きに入れる（公開はしない）", async () => {
  const m = mockFetch([
    ["POST", /note\.com\/api\/v1\/text_notes$/, { data: { id: 7, key: "nkey" } }],
    // 本文の画像: presigned_post で S3 の送り先を受け取り → S3 へ送る → url を本文に使う
    ["POST", /note\.com\/api\/v3\/images\/upload\/presigned_post$/, { data: { action: "https://note-assets.s3.example.com/", post: { key: "img/1.png", policy: "P", "x-amz-signature": "SIG" }, url: "https://assets.st-note.com/img/1.png" } }],
    ["POST", /^https:\/\/note-assets\.s3\.example\.com\/$/, () => ({ status: 201, text: "<PostResponse/>" })],
    ["POST", /note\.com\/api\/v1\/image_upload\/note_eyecatch$/, { data: { url: "https://assets.st-note.com/eye.png" } }],
    ["POST", /note\.com\/api\/v1\/text_notes\/draft_save\?id=7$/, { data: {} }],
  ]);
  try {
    const text = "# T\n\n## 見出し\n\n**大事**なこと\n\n![図解](media:a.png)\n\n<!-- paywall -->\n\n有料部分";
    const r = await PLATFORMS.note.publish!(
      ctx({ credentials: { cookie: "_note_session_v5=S" } }),
      post({ text, tags: ["AI"], media: [media("image/png", 10, "a"), media("image/png", 10, "eye")], options: { price: "500", eyecatch: "eye.png" } })
    );
    const save = m.calls.find((c) => c.url.includes("draft_save"))!;
    assert.equal(save.json.status, "draft");
    assert.equal(save.json.price, 500);
    assert.match(save.json.body, /<strong>大事<\/strong>/);
    assert.match(save.json.body, /<figure name="[^"]+" id="[^"]+"><img src="https:\/\/assets\.st-note\.com\/img\/1\.png" alt="図解" width="620" height="auto">/);
    const s3 = m.calls.find((c) => c.url.startsWith("https://note-assets.s3"))!;
    assert.equal(s3.headers.cookie, undefined); // S3 にはログイン Cookie を送らない
    assert.equal(m.calls.find((c) => c.url.endsWith("/presigned_post"))!.headers.cookie, "_note_session_v5=S");
    assert.ok(!m.calls.some((c) => c.url.endsWith("/v1/upload_image")));
    // separator は「有料部分」の段落の ID
    const sepId = save.json.separator as string;
    assert.match(save.json.body, new RegExp(`<p name="${sepId}" id="${sepId}">有料部分</p>`));
    assert.ok(m.calls.some((c) => c.url.endsWith("/image_upload/note_eyecatch")));
    assert.ok(!m.calls.some((c) => /publish|status.*published/.test(c.url)));
    assert.match(r.note!, /画像1枚・見出し画像・有料ライン・価格500円・タグ1件/);
  } finally {
    m.restore();
  }
});

test("note: 有料設定や画像が拒否されても本文の下書きは保存し、入らなかった項目を返す", async () => {
  let saves = 0;
  const m = mockFetch([
    ["POST", /note\.com\/api\/v1\/text_notes$/, { data: { id: 8, key: "nk" } }],
    ["POST", /note\.com\/api\/v3\/images\/upload\/presigned_post$/, () => ({ status: 404, text: "not found" })],
    ["POST", /note\.com\/api\/v1\/upload_image$/, () => ({ status: 404, text: "not found" })],
    ["POST", /note\.com\/api\/v1\/text_notes\/draft_save\?id=8$/, (c: any) => (saves++, c.json.price ? { status: 422, text: "bad" } : { json: { data: {} } })],
  ]);
  try {
    const r = await PLATFORMS.note.publish!(
      ctx({ credentials: { cookie: "_note_session_v5=S" } }),
      post({ text: "本文\n\n![](media:a.png)\n\n<!-- paywall -->\n\n続き", media: [media("image/png", 10, "a")], options: { price: "300" } })
    );
    assert.equal(saves, 2);
    const last = m.calls.filter((c) => c.url.includes("draft_save")).at(-1)!;
    assert.equal(last.json.price, undefined);
    assert.match(last.json.body, /［画像：ここに画像］/);
    assert.match(r.note!, /アップロードできませんでした/);
    assert.match(r.note!, /有料ライン・価格を設定できませんでした/);
  } finally {
    m.restore();
  }
});

test("note: presigned_post が使えないときは旧方式の upload_image で本文の画像を上げる", async () => {
  const m = mockFetch([
    ["POST", /note\.com\/api\/v1\/text_notes$/, { data: { id: 9, key: "nk9" } }],
    ["POST", /note\.com\/api\/v3\/images\/upload\/presigned_post$/, () => ({ status: 404, text: "not found" })],
    ["POST", /note\.com\/api\/v1\/upload_image$/, { data: { url: "https://assets.st-note.com/img/old.png" } }],
    ["POST", /note\.com\/api\/v1\/text_notes\/draft_save\?id=9$/, { data: {} }],
  ]);
  try {
    const r = await PLATFORMS.note.publish!(ctx({ credentials: { cookie: "_note_session_v5=S" } }), post({ text: "本文\n\n![](media:a.png)", media: [media("image/png", 10, "a")] }));
    const save = m.calls.find((c) => c.url.includes("draft_save"))!;
    assert.match(save.json.body, /<img src="https:\/\/assets\.st-note\.com\/img\/old\.png"/);
    assert.match(r.note!, /画像1枚/);
  } finally {
    m.restore();
  }
});

test("note: 価格の範囲チェック・目印の変換", () => {
  assert.equal(notePrice(""), null);
  assert.equal(notePrice("1,000円"), 1000);
  assert.throws(() => notePrice("50"), /100〜50,000/);
  const { html, separator } = markdownToNote("前\n\n<!-- image: 朝の風景 -->\n<!-- paywall -->\n## 有料の見出し", { note: true });
  assert.match(html, /［画像：朝の風景］/);
  assert.match(html, new RegExp(`<h2 name="${separator}"`));
  assert.equal(markdownToNote("<!-- paywall -->\n本文").separator, undefined);
  assert.doesNotMatch(markdownToNote("<!-- image: x -->\n本文").html, /画像/);
});

test("Medium: /v1/users/{id}/posts に markdown で投稿", async () => {
  const m = mockFetch([["POST", /api\.medium\.com\/v1\/users\/AU\/posts$/, { data: { id: "p", url: "https://medium.com/p" } }]]);
  try {
    await PLATFORMS.medium.publish!(ctx({ credentials: { token: "t", authorId: "AU" }, settings: { publishStatus: "draft" } }), post({ options: { title: "T" } }));
    assert.equal(m.calls[0].json.contentFormat, "markdown");
    assert.equal(m.calls[0].json.publishStatus, "draft");
  } finally {
    m.restore();
  }
});

test("Bluesky: 公式SDKで createSession → createRecord（リンクは facets）", async () => {
  const m = mockFetch([
    ["POST", /com\.atproto\.server\.createSession$/, { accessJwt: "a", refreshJwt: "r", handle: "me.bsky.social", did: "did:plc:me", active: true }],
    ["POST", /com\.atproto\.repo\.createRecord$/, { uri: "at://did:plc:me/app.bsky.feed.post/3kx", cid: "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm" }],
  ]);
  try {
    const r = await PLATFORMS.bluesky.publish!(
      ctx({ credentials: { identifier: "me.bsky.social", appPassword: "xxxx", service: "https://bsky.social" } }),
      post({ text: "見て https://example.com" })
    );
    const rec = m.calls.find((c) => c.url.endsWith("createRecord"))!.json;
    assert.equal(rec.collection, "app.bsky.feed.post");
    assert.equal(rec.record.facets[0].features[0].uri, "https://example.com");
    assert.equal(r.url, "https://bsky.app/profile/me.bsky.social/post/3kx");
  } finally {
    m.restore();
  }
});

test("全プラットフォーム: 定義の整合性", () => {
  for (const p of Object.values(PLATFORMS)) {
    if (p.support === "manual") assert.equal(p.publish, undefined, p.id);
    else assert.ok(p.publish, p.id);
    if (p.connection === "oauth") assert.ok(p.oauth, p.id);
    if (p.connection === "credentials") assert.ok(p.connect && p.accountFields.length, p.id);
  }
});

test("フォロワー数とプロフィール画像: X は users/me、Threads は threads_insights と me、YouTube は channels", async () => {
  const m = mockFetch([
    ["GET", /api\.x\.com\/2\/users\/me\?/, { data: { id: "42", profile_image_url: "https://pbs.twimg.com/profile_images/1/a_normal.jpg", public_metrics: { followers_count: 1200, following_count: 80, tweet_count: 950 } } }],
    ["GET", /graph\.threads\.net\/v1\.0\/acct\/threads_insights\?/, { data: [{ name: "followers_count", total_value: { value: 340 } }] }],
    ["GET", /graph\.threads\.net\/v1\.0\/me\?/, { threads_profile_picture_url: "https://scontent.cdninstagram.com/p.jpg" }],
    ["GET", /youtube\/v3\/channels\?part=statistics/, { items: [{ statistics: { subscriberCount: "5000", videoCount: "12", hiddenSubscriberCount: false }, snippet: { thumbnails: { high: { url: "https://yt3.ggpht.com/h.jpg" } } } }] }],
  ]);
  try {
    assert.deepEqual(await PLATFORMS.x.fetchProfile!(ctx()), { followers: 1200, following: 80, posts: 950, imageUrl: "https://pbs.twimg.com/profile_images/1/a_400x400.jpg" });
    assert.match(m.calls[0].url, /user\.fields=public_metrics%2Cprofile_image_url/);
    assert.deepEqual(await PLATFORMS.threads.fetchProfile!(ctx()), { followers: 340, imageUrl: "https://scontent.cdninstagram.com/p.jpg" });
    assert.match(m.calls[1].url, /metric=followers_count/);
    assert.deepEqual(await PLATFORMS.youtube.fetchProfile!(ctx()), { followers: 5000, posts: 12, imageUrl: "https://yt3.ggpht.com/h.jpg" });
  } finally {
    m.restore();
  }
});

test("Threads: アカウントの日別閲覧数（views の時系列）を日本時間の日付で返す", async () => {
  const m = mockFetch([
    ["GET", /threads_insights\?metric=views/, { data: [{ name: "views", values: [{ value: 120, end_time: "2026-10-04T07:00:00+0000" }, { value: 90, end_time: "2026-10-05T07:00:00+0000" }] }] }],
  ]);
  try {
    const r = await PLATFORMS.threads.fetchInsights!(ctx(), { days: 7 });
    assert.deepEqual(r.daily, [{ date: "2026-10-04", views: 120 }, { date: "2026-10-05", views: 90 }]);
  } finally {
    m.restore();
  }
});
