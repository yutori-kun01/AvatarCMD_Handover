import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS } from "../src/platforms";
import { escapeLittleText } from "../src/platforms/linkedin";
import { tiktokChunks } from "../src/platforms/tiktok";
import { zennTopics } from "../src/platforms/zenn";
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
    ["GET", /api\.x\.com\/2\/users\/me$/, { data: { id: "42", username: "yutori" } }],
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
    const r = await PLATFORMS.x.publish!(ctx({ credentials: { accessToken: "AT", username: "yutori" } }), post({ media: [media("image/png")] }));
    assert.equal(m.calls[0].json.media_category, "tweet_image");
    assert.ok(typeof m.calls[0].json.media === "string");
    assert.deepEqual(m.calls[1].json, { text: "hello", media: { media_ids: ["M1"] } });
    assert.equal(m.calls[1].headers.authorization, "Bearer AT");
    assert.equal(r.url, "https://x.com/yutori/status/T1");
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
