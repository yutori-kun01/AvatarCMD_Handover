// YouTube チャンネルからの学習のテスト（単体 + 実 DB）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";
import { captionsToText, FEED_RETRY, parseChannelId, parseFeed, pickCaptionTrack } from "../src/service/youtube-learning";
import { normalizeForQuote, quoteInSource } from "../src/service/learning-summary";
import { ApiError } from "../src/http";

FEED_RETRY.waitMs = 0;

const FEED = (entries: { id: string; title: string; published: string; desc?: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>集中チャンネル</title>
 ${entries
   .map(
     (e) => `<entry>
  <id>yt:video:${e.id}</id><yt:videoId>${e.id}</yt:videoId>
  <title>${e.title}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${e.id}"/>
  <published>${e.published}</published>
  <media:group><media:description>${e.desc ?? ""}</media:description></media:group>
 </entry>`
   )
   .join("\n")}
</feed>`;

test("チャンネル ID・フィード・字幕の解析", () => {
  assert.equal(parseChannelId("UCabcdefghijklmnopqrstuv"), "UCabcdefghijklmnopqrstuv");
  assert.equal(parseChannelId("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos"), "UCabcdefghijklmnopqrstuv");
  assert.equal(parseChannelId("https://www.youtube.com/@someone"), null);
  const f = parseFeed(FEED([{ id: "vid0000001", title: "朝の集中 &amp; 習慣", published: "2026-10-01T00:00:00+00:00", desc: "説明" }]));
  assert.equal(f.title, "集中チャンネル");
  assert.deepEqual(f.entries.map((e) => [e.videoId, e.title, e.url]), [["vid0000001", "朝の集中 & 習慣", "https://www.youtube.com/watch?v=vid0000001"]]);
  assert.equal(captionsToText("1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n\n2\n00:00:02,000 --> 00:00:03,000\nこんにちは\n今日は"), "こんにちは\n今日は");
});

// YouTube の自動生成字幕（ASR）の VTT は、前のキューの行を次のキューで繰り返す
const ASR_VTT = `WEBVTT
Kind: captions
Language: ja

00:00:00.399 --> 00:00:04.710 align:start position:0%
 
2026<00:00:01.000><c>年</c><00:00:01.280><c>上</c><00:00:01.480><c>半期</c><00:00:01.839><c>。</c><00:00:02.159><c>いや</c><00:00:02.679><c>2026</c><00:00:03.199><c>年</c><00:00:03.760><c>で</c><00:00:04.359><c>早く</c>

00:00:04.710 --> 00:00:04.720 align:start position:0%
2026年上半期。いや2026年で早く
 

00:00:04.720 --> 00:00:07.590 align:start position:0%
2026年上半期。いや2026年で早く
も<00:00:04.960><c>世界</c><00:00:05.279><c>で</c><00:00:05.400><c>最も</c><00:00:05.839><c>反響</c><00:00:06.160><c>が</c><00:00:06.279><c>あっ</c><00:00:06.399><c>た</c><00:00:06.600><c>投稿</c><00:00:06.919><c>が</c><00:00:07.080><c>さ</c><00:00:07.200><c>れ</c><00:00:07.319><c>た</c><00:00:07.439><c>か</c>

00:00:07.590 --> 00:00:07.600 align:start position:0%
も世界で最も反響があった投稿がされたか
 

00:00:07.600 --> 00:00:09.870 align:start position:0%
も世界で最も反響があった投稿がされたか
も<00:00:07.720><c>しれ</c><00:00:07.860><c>[音楽]</c><00:00:07.960><c>ませ</c><00:00:08.120><c>ん</c><00:00:08.200><c>。</c>

00:00:09.870 --> 00:00:09.880 align:start position:0%
もしれ[音楽]ません。
 
`;

test("自動生成字幕: 流れる表示の重複・タイムスタンプタグ・[音楽] を除いて本文にする", () => {
  assert.equal(captionsToText(ASR_VTT), "2026年上半期。いや2026年で早く\nも世界で最も反響があった投稿がされたか\nもしれません。");
  // 行が伸びていく表示は、伸びた行だけを残す
  assert.equal(captionsToText("1\n00:00:01,000 --> 00:00:02,000\n今日は\n\n2\n00:00:02,000 --> 00:00:03,000\n今日は朝の話\n\n3\n00:00:03,000 --> 00:00:04,000\n朝の話"), "今日は朝の話");
  assert.equal(captionsToText("WEBVTT\n\nNOTE これは注記\n続き\n\n00:00.000 --> 00:01.000\n[拍手] 本文 ♪"), "本文");
});

test("字幕トラックは日本語の手動字幕を優先する", () => {
  const t = (language: string, trackKind: string) => ({ id: `${language}-${trackKind}`, snippet: { language, trackKind } });
  assert.equal(pickCaptionTrack([t("en", "standard"), t("ja", "asr"), t("ja", "standard")])!.id, "ja-standard");
  assert.equal(pickCaptionTrack([t("en", "asr"), t("ja", "asr")])!.id, "ja-asr");
  assert.equal(pickCaptionTrack([t("en", "asr"), t("en", "standard")])!.id, "en-standard");
});

test("要点の根拠の照合は句読点・空白・字幕の注記の違いを無視する", () => {
  const src = normalizeForQuote("光を浴びると、体内時計が整って [音楽] 午前中の集中が続きやすくなります。");
  assert.ok(quoteInSource(src, "光を浴びると体内時計が整って午前中の集中が続きやすくなります"));
  assert.ok(quoteInSource(src, "「光を浴びると、体内時計が整って、午前中の集中」"));
  assert.ok(!quoteInSource(src, "夜にスマホを見ると眠れなくなります"));
  assert.ok(!quoteInSource(src, "光")); // 短すぎる抜粋は根拠にしない
});

test("HTML のエラーページはエラーメッセージに丸ごと載せない", () => {
  const html = '<!DOCTYPE html>\n<html lang=en>\n  <meta charset=utf-8>\n  <title>Error 404 (Not Found)!!1</title>\n  <style>*{margin:0}</style>';
  const e = new ApiError("youtube", 404, html);
  assert.equal(e.message, "youtube API error 404: (HTML のエラーページ: Error 404 (Not Found)!!1)");
});

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };
type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let ytAccount = "";
const TOUCHED = ["anthropic_api_key"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const OWN = "UCownownownownownownown1";
const OTHER = "UCotherotherotherother12";
let channelIds: string[] = [];

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  await svc.setSetting("anthropic_api_key", "ak-test");
  await prisma.youtubeChannel.deleteMany({ where: { channelId: { in: [OWN, OTHER] } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `yt-${tag}@example.com` } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `YT-${tag}` } })).id;
  ytAccount = (await svc.saveConnectedAccount(avatarId, "youtube", { accountId: `yt${tag}`, accountName: "My channel", credentials: { accessToken: "YT", refreshToken: "R", expiresAt: new Date(Date.now() + 86400_000).toISOString() } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.youtubeChannel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.$disconnect();
});

const TRANSCRIPT = "今日は朝の集中について話します。朝起きたらまず窓を開けて光を浴びてください。光を浴びると体内時計が整って、午前中の集中が続きやすくなります。もう一つは、最初の30分はスマホを見ないことです。これだけで作業に入るまでの時間が短くなります。";
let captionsStatus = 200;
let feedMode: "ok" | "404" | "all404" = "ok";
const HTML_404 = '<!DOCTYPE html><html lang=en><meta charset=utf-8><title>Error 404 (Not Found)!!1</title>';

function mocks() {
  const now = new Date();
  const recent = new Date(now.getTime() - 2 * 86400_000).toISOString();
  const old = new Date(now.getTime() - 90 * 86400_000).toISOString();
  return mockFetch([
    ["GET", new RegExp(`feeds/videos\\.xml\\?channel_id=${OTHER}`), () => ({ text: FEED([{ id: "oth0000001", title: "他の人の新しい動画", published: recent, desc: "説明文だけ" }, { id: "oth0000000", title: "古い動画", published: old }]) })],
    ["GET", new RegExp(`feeds/videos\\.xml\\?channel_id=${OWN}`), () => (feedMode === "ok" ? { text: FEED([{ id: "own0000001", title: "自分の動画", published: recent }]) } : { status: 404, text: HTML_404 })],
    ["GET", new RegExp(`feeds/videos\\.xml\\?playlist_id=UU${OWN.slice(2)}`), () => (feedMode === "404" ? { text: FEED([{ id: "own0000002", title: "再生リスト経由の動画", published: recent }]) } : { status: 404, text: HTML_404 })],
    ["GET", /youtube\/v3\/playlistItems/, () => ({ json: { items: [{ snippet: { title: "API 経由の動画", channelTitle: "自分", publishedAt: recent }, contentDetails: { videoId: "own0000003", videoPublishedAt: recent } }] } })],
    ["GET", /youtube\/v3\/captions\?part=snippet/, () => (captionsStatus === 200 ? { json: { items: [{ id: "cap1", snippet: { language: "ja", trackKind: "standard" } }] } } : { status: captionsStatus, json: { error: { code: captionsStatus, message: "insufficientPermissions" } } })],
    ["GET", /youtube\/v3\/captions\/cap1\?tfmt=srt/, () => ({ text: `1\n00:00:00,000 --> 00:00:05,000\n${TRANSCRIPT}\n` })],
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => ({
        text: claudeSse(
          c.json.model,
          JSON.stringify({
            summary: "朝に光を浴び、最初の30分はスマホを見ないと午前の集中が続きやすい",
            points: [
              { point: "朝に光を浴びると体内時計が整う", quote: "光を浴びると体内時計が整って" },
              { point: "根拠の無い要点", quote: "この文は文字起こしに無い" },
            ],
            tags: ["朝", "集中"],
          })
        ),
        headers: { "content-type": "text/event-stream" },
      }),
    ],
  ]);
}

test("他の人のチャンネル: 新動画を検知（対象期間外・重複は取り込まない）。本文が無ければ要約しない。文字起こしを登録すると根拠付きでナレッジに保存", opts, async () => {
  const m = mocks();
  try {
    await assert.rejects(svc.createChannel({ channel: "https://www.youtube.com/@x", avatarIds: [avatarId] }), /チャンネル ID/);
    const ch = await svc.createChannel({ channel: OTHER, ownership: "other", avatarIds: [avatarId], lookbackDays: 30 });
    channelIds.push(ch.id);
    assert.equal(await svc.pollChannel(ch.id), 1);
    assert.equal(await svc.pollChannel(ch.id), 0); // 二重に取り込まない
    const v = await prisma.youtubeVideo.findFirstOrThrow({ where: { channelRowId: ch.id } });
    assert.equal(v.transcriptStatus, "pending");
    // 本文待ちの動画は要約しない（説明文だけで要約しない）
    await assert.rejects(svc.summarizeVideo(v.id), /本文/);
    assert.equal(m.calls.filter((c) => /anthropic/.test(c.url)).length, 0);
    // worker でも、他の人の動画は本文が無ければ要約しない
    await prisma.youtubeChannel.update({ where: { id: ch.id }, data: { lastPolledAt: null } });
    await svc.processYoutubeChannels();
    assert.equal((await prisma.youtubeVideo.findUniqueOrThrow({ where: { id: v.id } })).transcriptStatus, "pending");

    await assert.rejects(svc.submitTranscript(v.id, "短い"), /短すぎ/);
    await svc.submitTranscript(v.id, TRANSCRIPT);
    const done = await svc.summarizeVideo(v.id);
    assert.equal(done.transcriptStatus, "summarized");
    assert.equal((done.summaryEvidence as any).points.length, 1); // 根拠を確認できない要点は捨てる
    assert.equal((done.summaryEvidence as any).method, "manual:human");
    const k = await prisma.knowledgeItem.findUniqueOrThrow({ where: { id: done.knowledgeIds[0] } });
    assert.equal(k.kind, "fact");
    assert.equal(k.sourceUrl, "https://www.youtube.com/watch?v=oth0000001");
    assert.equal(k.createdBy, "youtube:oth0000001");
    // 要約済みは再要約しない
    await svc.summarizeVideo(v.id);
    assert.equal(m.calls.filter((c) => /anthropic/.test(c.url)).length, 1);
    await assert.rejects(svc.submitTranscript(v.id, TRANSCRIPT), /要約済み/);
  } finally {
    m.restore();
  }
});

test("自分のチャンネル: 公式字幕 API で本文を取得（権限が無ければ本文待ちのまま理由を表示）。クォータを台帳に記録", opts, async () => {
  const m = mocks();
  try {
    const ch = await svc.createChannel({ channel: OWN, ownership: "own", avatarIds: [avatarId], ownerAccountId: ytAccount });
    channelIds.push(ch.id);
    await svc.pollChannel(ch.id);
    const v = await prisma.youtubeVideo.findFirstOrThrow({ where: { channelRowId: ch.id } });

    captionsStatus = 403;
    assert.equal(await svc.fetchOwnCaptions(v.id), false);
    let cur = await prisma.youtubeVideo.findUniqueOrThrow({ where: { id: v.id } });
    assert.equal(cur.transcriptStatus, "pending");
    assert.match(cur.error!, /権限/);

    captionsStatus = 200;
    await prisma.youtubeVideo.update({ where: { id: v.id }, data: { error: null } });
    assert.equal(await svc.fetchOwnCaptions(v.id), true);
    cur = await prisma.youtubeVideo.findUniqueOrThrow({ where: { id: v.id } });
    assert.equal(cur.transcriptStatus, "available");
    assert.equal(cur.transcriptMethod, "captions_api");
    assert.match(cur.transcript!, /体内時計/);
    const quota = await prisma.usageLedger.aggregate({ where: { provider: "youtube", subjectId: v.id }, _sum: { quotaUnits: true } });
    assert.equal(quota._sum.quotaUnits, 50 + 50 + 200); // 失敗した1回目の一覧 + 成功時の一覧 + ダウンロード
  } finally {
    m.restore();
  }
});

test("フィードが 404 のとき: 再試行 → 再生リストのフィード → Data API の順に切り替える（HTML のエラーページは表示しない）", opts, async () => {
  const m = mocks();
  try {
    await prisma.youtubeChannel.deleteMany({ where: { channelId: OWN } });
    const ch = await svc.createChannel({ channel: OWN, ownership: "own", avatarIds: [avatarId], ownerAccountId: ytAccount });
    channelIds.push(ch.id);
    feedMode = "404";
    assert.equal(await svc.pollChannel(ch.id), 1);
    assert.equal(m.calls.filter((c) => c.url.includes(`channel_id=${OWN}`)).length, 2); // 1 回だけ再試行
    assert.ok(await prisma.youtubeVideo.findFirst({ where: { channelRowId: ch.id, videoId: "own0000002" } }));
    feedMode = "all404";
    assert.equal(await svc.pollChannel(ch.id), 1);
    assert.ok(await prisma.youtubeVideo.findFirst({ where: { channelRowId: ch.id, videoId: "own0000003" } }));
    const quota = await prisma.usageLedger.aggregate({ where: { provider: "youtube", subjectId: ch.id }, _sum: { quotaUnits: true } });
    assert.equal(quota._sum.quotaUnits, 1);
    // アカウントも無いと、理由と対処を表示する（HTML は載せない）
    await prisma.youtubeChannel.update({ where: { id: ch.id }, data: { ownerAccountId: null } });
    const accounts = await prisma.snsAccount.findMany({ where: { platform: "youtube" } });
    await prisma.snsAccount.updateMany({ where: { platform: "youtube" }, data: { platform: "youtube_tmp" } });
    try {
      await prisma.youtubeChannel.update({ where: { id: ch.id }, data: { lastPolledAt: null } });
      await svc.processYoutubeChannels();
      const cur = await prisma.youtubeChannel.findUniqueOrThrow({ where: { id: ch.id } });
      assert.match(cur.lastError!, /チャンネル ID が正しいか/);
      assert.doesNotMatch(cur.lastError!, /DOCTYPE/);
    } finally {
      await prisma.snsAccount.updateMany({ where: { id: { in: accounts.map((a) => a.id) } }, data: { platform: "youtube" } });
    }
  } finally {
    feedMode = "ok";
    m.restore();
  }
});
