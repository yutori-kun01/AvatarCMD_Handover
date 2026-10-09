// 動画パイプラインの投稿まわり（YouTube の予約公開・サムネイル・字幕、TikTok の AI ラベル・下書き、Instagram リール）
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS } from "../src/platforms";
import { parsePublishAt } from "../src/platforms/youtube";
import { reelParams } from "../src/platforms/instagram";
import { ctx, media, mockFetch } from "./helpers";

const post = (p: Partial<import("../src/types").PostInput> = {}) => ({ text: "hello", media: [], options: {}, ...p });
const future = new Date(Date.now() + 3 * 86400_000).toISOString();

test("YouTube: 既定は非公開でアップロードする", async () => {
  const m = mockFetch([
    ["POST", /upload\/youtube\/v3\/videos/, () => ({ json: {}, headers: { location: "https://upload.example/u1" } })],
    ["PUT", /upload\.example\/u1$/, { id: "VID" }],
  ]);
  try {
    const r = await PLATFORMS.youtube.publish!(ctx(), post({ media: [media("video/mp4", 100)] }));
    assert.equal(m.calls[0].json.status.privacyStatus, "private");
    assert.equal(m.calls[0].json.status.selfDeclaredMadeForKids, false);
    assert.equal(m.calls[0].json.status.publishAt, undefined);
    assert.match(r.note ?? "", /private/);
  } finally {
    m.restore();
  }
});

test("YouTube: 予約公開日時を指定すると、公開設定にかかわらず非公開 + publishAt。サムネイルと字幕も登録する", async () => {
  const m = mockFetch([
    ["POST", /upload\/youtube\/v3\/videos/, () => ({ json: {}, headers: { location: "https://upload.example/u1" } })],
    ["PUT", /upload\.example\/u1$/, { id: "VID" }],
    ["POST", /thumbnails\/set\?videoId=VID$/, {}],
    ["POST", /captions\?part=snippet&uploadType=multipart$/, { id: "CAP" }],
  ]);
  try {
    const r = await PLATFORMS.youtube.publish!(
      ctx({ settings: { privacyStatus: "public" } }),
      post({ media: [media("video/mp4", 100), media("image/png", 20, "thumb")], options: { publishAt: future, captionsSrt: "1\n00:00:00,000 --> 00:00:01,000\nこんにちは\n" } })
    );
    assert.equal(m.calls[0].json.status.privacyStatus, "private");
    assert.equal(m.calls[0].json.status.publishAt, new Date(future).toISOString());
    assert.equal(m.calls[2].headers["content-type"], "image/png");
    assert.match(m.calls[3].headers["content-type"], /^multipart\/related; boundary=/);
    assert.match(m.calls[3].body, /"videoId":"VID"/);
    assert.match(m.calls[3].body, /こんにちは/);
    assert.match(r.note ?? "", /公開予約/);
    assert.match(r.note ?? "", /サムネイルを設定/);
    assert.match(r.note ?? "", /字幕を登録/);
  } finally {
    m.restore();
  }
});

test("YouTube: アップロード後のサムネイル・字幕の失敗では投稿を失敗にしない（二重アップロード防止）", async () => {
  const m = mockFetch([
    ["POST", /upload\/youtube\/v3\/videos/, () => ({ json: {}, headers: { location: "https://upload.example/u1" } })],
    ["PUT", /upload\.example\/u1$/, { id: "VID" }],
    ["POST", /thumbnails\/set/, () => ({ status: 403, text: "forbidden" })],
    ["POST", /captions/, () => ({ status: 403, text: "insufficient scope" })],
  ]);
  try {
    const r = await PLATFORMS.youtube.publish!(ctx(), post({ media: [media("video/mp4", 100), media("image/jpeg")], options: { captionsSrt: "x" } }));
    assert.equal(r.postId, "VID");
    assert.match(r.note ?? "", /サムネイルの設定に失敗: 権限/);
    assert.match(r.note ?? "", /字幕の登録に失敗/);
  } finally {
    m.restore();
  }
});

test("YouTube: 予約公開日時の検証", () => {
  assert.equal(parsePublishAt(""), null);
  assert.equal(parsePublishAt(undefined), null);
  assert.throws(() => parsePublishAt("2020-01-01T00:00:00Z"), /過去/);
  assert.throws(() => parsePublishAt("あした"), /読めません/);
  assert.equal(parsePublishAt("2030-01-01T19:00:00+09:00"), "2030-01-01T10:00:00.000Z");
});

const tiktokRoutes = (extra: [string, RegExp, object][] = []) =>
  mockFetch([
    ["POST", /creator_info\/query\/$/, { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }],
    ["POST", /post\/publish\/video\/init\/$/, { data: { publish_id: "PUB", upload_url: "https://up.tiktok/x" }, error: { code: "ok" } }],
    ["POST", /inbox\/video\/init\/$/, { data: { publish_id: "INBOX", upload_url: "https://up.tiktok/x" }, error: { code: "ok" } }],
    ["PUT", /up\.tiktok\/x$/, {}],
    ...extra,
  ]);

test("TikTok: AI 生成ラベルは既定でオン、投稿ごとに上書きできる。デュエット/リミックスの可否を送る", async () => {
  const m = tiktokRoutes([["POST", /status\/fetch\/$/, { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [1] }, error: { code: "ok" } }]]);
  try {
    const r = await PLATFORMS.tiktok.publish!(ctx({ settings: { privacyLevel: "SELF_ONLY", disableDuet: "true" } }), post({ media: [media("video/mp4", 1000)] }));
    const info = m.calls[1].json.post_info;
    assert.equal(info.is_aigc, true);
    assert.equal(info.disable_duet, true);
    assert.equal(info.disable_stitch, false);
    assert.match(r.note ?? "", /AI 生成ラベル/);
    await PLATFORMS.tiktok.publish!(ctx({ settings: { privacyLevel: "SELF_ONLY" } }), post({ media: [media("video/mp4", 1000)], options: { aiGenerated: "false" } }));
    const second = m.calls.filter((c) => /video\/init\/$/.test(c.url) && !/inbox/.test(c.url))[1].json.post_info;
    assert.equal(second.is_aigc, false);
  } finally {
    m.restore();
  }
});

test("TikTok: 下書きモードは受信トレイへ送る（公開範囲の設定は不要）", async () => {
  const m = tiktokRoutes([["POST", /status\/fetch\/$/, { data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } }]]);
  try {
    const r = await PLATFORMS.tiktok.publish!(ctx({ settings: { postMode: "draft" } }), post({ media: [media("video/mp4", 1000)] }));
    assert.match(m.calls[0].url, /inbox\/video\/init\/$/);
    assert.equal(m.calls[0].json.post_info, undefined);
    assert.equal(r.postId, "INBOX");
    assert.match(r.note ?? "", /受信トレイ/);
  } finally {
    m.restore();
  }
  await assert.rejects(PLATFORMS.tiktok.publish!(ctx({ settings: { postMode: "draft" } }), post({ media: [media("image/jpeg")] })), /動画のみ/);
});

test("Instagram: 動画 1 本はリール。フィード表示とカバー位置を指定できる", async () => {
  assert.deepEqual(reelParams({}), { share_to_feed: "true" });
  assert.deepEqual(reelParams({ shareToFeed: "false", thumbOffsetMs: "1500" }), { share_to_feed: "false", thumb_offset: "1500" });
  assert.deepEqual(reelParams({ thumbOffsetMs: "abc" }), { share_to_feed: "true" });
  const m = mockFetch([
    ["POST", /graph\.instagram\.com\/v26\.0\/IG\/media$/, { id: "C1" }],
    ["GET", /graph\.instagram\.com\/v26\.0\/C1\?/, { status_code: "FINISHED" }],
    ["POST", /graph\.instagram\.com\/v26\.0\/IG\/media_publish$/, { id: "M1" }],
    ["GET", /graph\.instagram\.com\/v26\.0\/M1\?/, { permalink: "https://www.instagram.com/reel/abc/" }],
  ]);
  try {
    await PLATFORMS.instagram.publish!(ctx({ credentials: { accessToken: "AT", userId: "IG" } }), post({ media: [media("video/mp4")], options: { shareToFeed: "false" } }));
    assert.equal(m.calls[0].form!.media_type, "REELS");
    assert.equal(m.calls[0].form!.share_to_feed, "false");
  } finally {
    m.restore();
  }
});
