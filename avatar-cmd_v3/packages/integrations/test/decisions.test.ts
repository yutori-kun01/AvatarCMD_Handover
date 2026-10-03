// 判定ルール（コード側のポリシー）と、指標・タイムライン・引用の API 呼び出し
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS } from "../src/platforms";
import { postGatePolicy } from "../src/service/post-decision";
import { quotePolicy, ruleOutReason } from "../src/service/quotes";
import { metricsDue, summarizeMetrics } from "../src/service/metrics";
import { computeStats, median, ruleVerdict } from "../src/service/performance";
import type { TimelinePost } from "../src/types";
import { ctx, mockFetch } from "./helpers";

const H = 3600_000;

test("投稿の可否ポリシー: Jev の判定を閾値で自動投稿の可否に変換する", () => {
  const ok = { action: "publish" as const, confidence: 0.9, brandRisk: 0.2, duplicateRisk: 0.1, personaFit: 1.8 };
  assert.equal(postGatePolicy(ok).publish, true);
  assert.equal(postGatePolicy({ ...ok, action: "review" }).publish, false);
  assert.equal(postGatePolicy({ ...ok, action: "hold" }).publish, false);
  assert.match(postGatePolicy({ ...ok, confidence: 0.4 }).reason, /確信度/);
  assert.match(postGatePolicy({ ...ok, brandRisk: 1.7 }).reason, /ブランド/);
  assert.match(postGatePolicy({ ...ok, duplicateRisk: 0.8 }).reason, /重複/);
  assert.match(postGatePolicy({ ...ok, personaFit: 0.2 }).reason, /口調/);
});

test("引用のポリシーと除外ルール", () => {
  assert.equal(quotePolicy({ direction: "aligned", alignedProb: 0.8, worth: 0.7, risk: 0.3 }).pass, true);
  assert.equal(quotePolicy({ direction: "partial", alignedProb: 0.8, worth: 0.9, risk: 0 }).pass, false);
  assert.equal(quotePolicy({ direction: "aligned", alignedProb: 0.5, worth: 0.9, risk: 0 }).pass, false);
  assert.equal(quotePolicy({ direction: "aligned", alignedProb: 0.9, worth: 0.3, risk: 0 }).pass, false);
  assert.equal(quotePolicy({ direction: "aligned", alignedProb: 0.9, worth: 0.9, risk: 1.5 }).pass, false);

  const now = new Date("2026-09-28T00:00:00Z");
  const base: TimelinePost = { id: "1", text: "集中力が切れたら場所を変えると戻りやすい。自分は午後にカフェへ移動するようにしてから作業が進むようになった。", url: "u", authorId: "a1", kind: "original", createdAt: "2026-09-27T20:00:00Z" };
  const c = { selfId: "me", now, recentAuthors: new Set(["a9"]) };
  assert.equal(ruleOutReason(base, c), null);
  assert.equal(ruleOutReason({ ...base, kind: "repost" }, c), "リポスト");
  assert.equal(ruleOutReason({ ...base, kind: "reply" }, c), "返信");
  assert.equal(ruleOutReason({ ...base, authorId: "me" }, c), "自分の投稿");
  assert.match(ruleOutReason({ ...base, text: "これ https://example.com/a" }, c)!, /短すぎる/);
  assert.equal(ruleOutReason({ ...base, createdAt: "2026-09-20T00:00:00Z" }, c), "古い投稿");
  assert.match(ruleOutReason({ ...base, authorId: "a9" }, c)!, /引用済み/);
});

test("指標の取得間隔と集計", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const at = (h: number) => new Date(now.getTime() - h * H);
  assert.equal(metricsDue(at(0.5), null, now), false); // 公開直後は待つ
  assert.equal(metricsDue(at(3), null, now), true);
  assert.equal(metricsDue(at(10), at(2), now), false); // 48時間以内は6時間ごと
  assert.equal(metricsDue(at(10), at(7), now), true);
  assert.equal(metricsDue(at(72), at(10), now), false); // それ以降は24時間ごと
  assert.equal(metricsDue(at(72), at(25), now), true);
  assert.equal(metricsDue(at(24 * 20), null, now), false); // 14日を過ぎたら取らない
  assert.deepEqual(summarizeMetrics({ views: 200, likes: 6, replies: 2, reposts: 1, quotes: 1 }), { engagements: 10, engagementRate: 0.05 });
  assert.deepEqual(summarizeMetrics({ likes: 3 }), { engagements: 3, engagementRate: null });
});

test("改善か継続か: 中央値の比較とコードのルール", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const row = (id: string, rate: number, topic = "朝", h = 0) => ({
    id,
    text: id,
    topic,
    platform: "x",
    publishedAt: new Date(Date.UTC(2026, 8, 1, h)),
    views: 1000,
    engagements: rate * 1000,
    engagementRate: rate,
  });
  const others = [row("o1", 0.04), row("o2", 0.05), row("o3", 0.06)];
  const good = computeStats([row("r1", 0.05), row("r2", 0.06), row("r3", 0.07)], others);
  assert.equal(good.basis, "rate");
  assert.ok(Math.abs(good.ratio! - 1.2) < 1e-9);
  assert.equal(ruleVerdict(good), "continue");
  const weak = computeStats([row("r1", 0.03, "朝"), row("r2", 0.035, "夜"), row("r3", 0.04, "夜")], others);
  assert.equal(ruleVerdict(weak), "improve");
  assert.deepEqual(weak.byTopic.map((t) => t.topic).sort(), ["夜", "朝"]);
  assert.equal(ruleVerdict(computeStats([row("r1", 0.05)], others)), "insufficient");
  // 比較対象が無ければ、このルールの前半と後半を比べる
  const trend = computeStats([row("a", 0.08, "t", 1), row("b", 0.08, "t", 2), row("c", 0.08, "t", 3), row("d", 0.02, "t", 4), row("e", 0.02, "t", 5), row("f", 0.02, "t", 6)], []);
  assert.equal(trend.baseline, "trend");
  assert.equal(trend.ratio, 0.25);
  assert.equal(ruleVerdict({ ...trend, posts: 8 }), "stop");
});

test("X: 引用投稿は quote_tweet_id を使わず、元投稿の URL を本文に入れて送る（ID だけでも URL を組み立てる）", async () => {
  const m = mockFetch([["POST", /\/2\/tweets$/, { data: { id: "T9" } }]]);
  try {
    await PLATFORMS.x.publish!(ctx({ credentials: { accessToken: "AT", username: "yutori" } }), { text: "わかる。自分も…", media: [], options: {}, quotePostId: "123456" });
    assert.deepEqual(m.calls[0].json, { text: "わかる。自分も… https://x.com/i/status/123456 " });
    // URL として読めない引用元はエラー（黙って通常投稿にしない）
    await assert.rejects(PLATFORMS.x.publish!(ctx({ credentials: { accessToken: "AT", username: "yutori" } }), { text: "x", media: [], options: {}, quotePostId: "Q1" }), /URL が不正/);
    assert.equal(m.calls.length, 1);
  } finally {
    m.restore();
  }
});

test("X: 自分の投稿の反応を /2/users/{id}/tweets の public_metrics から取る（見つからない投稿は理由付き）", async () => {
  const m = mockFetch([
    [
      "GET",
      /\/2\/users\/42\/tweets\?/,
      {
        data: [
          { id: "T1", public_metrics: { impression_count: 500, like_count: 10, reply_count: 2, retweet_count: 3, quote_count: 1, bookmark_count: 4 } },
          { id: "OTHER", public_metrics: { like_count: 1 } },
        ],
        meta: {},
      },
    ],
  ]);
  try {
    const r = await PLATFORMS.x.fetchMetrics!(ctx({ credentials: { accessToken: "AT" }, account: { accountId: "42", accountName: "@y" } }), [
      { postId: "T1", publishedAt: new Date("2026-09-27T00:00:00Z") },
      { postId: "GONE", publishedAt: new Date("2026-09-26T00:00:00Z") },
    ]);
    assert.deepEqual(r.T1, { views: 500, likes: 10, replies: 2, reposts: 3, quotes: 1, bookmarks: 4 });
    assert.ok("error" in r.GONE);
    const u = new URL(m.calls[0].url);
    assert.equal(u.searchParams.get("tweet.fields"), "public_metrics,created_at");
    assert.equal(u.searchParams.get("start_time"), "2026-09-25T23:59:00.000Z");
    assert.equal(m.calls.length, 1);
  } finally {
    m.restore();
  }
});

test("X: ホームタイムライン（reverse_chronological）を取得し、投稿の種類と投稿者を付ける", async () => {
  const m = mockFetch([
    [
      "GET",
      /\/2\/users\/42\/timelines\/reverse_chronological\?/,
      {
        data: [
          { id: "P1", text: "本文", author_id: "u1", created_at: "2026-09-27T10:00:00Z", public_metrics: { like_count: 5 } },
          { id: "P2", text: "RT @x: ...", author_id: "u2", referenced_tweets: [{ type: "retweeted", id: "Z" }] },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }, { id: "u2", username: "bob", name: "Bob" }] },
      },
    ],
  ]);
  try {
    const t = await PLATFORMS.x.fetchTimeline!(ctx({ credentials: { accessToken: "AT" }, account: { accountId: "42", accountName: "@y" } }), { maxResults: 30, sinceId: "P0" });
    assert.equal(t[0].url, "https://x.com/alice/status/P1");
    assert.equal(t[0].kind, "original");
    assert.equal(t[0].metrics?.likes, 5);
    assert.equal(t[1].kind, "repost");
    const u = new URL(m.calls[0].url);
    assert.equal(u.searchParams.get("since_id"), "P0");
    assert.equal(u.searchParams.get("exclude"), "replies");
    assert.equal(u.searchParams.get("max_results"), "30");
  } finally {
    m.restore();
  }
});

test("X: クレジット不足（402）はわかる言葉のエラーにする", async () => {
  const m = mockFetch([["GET", /timelines/, () => ({ status: 402, json: { title: "CreditsDepleted" } })]]);
  try {
    await assert.rejects(PLATFORMS.x.fetchTimeline!(ctx({ credentials: { accessToken: "AT" }, account: { accountId: "42", accountName: "@y" } }), { maxResults: 10 }), /クレジット/);
  } finally {
    m.restore();
  }
});

test("Threads: インサイト取得と、取れない理由（権限・フォロワー数）", async () => {
  const m = mockFetch([
    [
      "GET",
      /graph\.threads\.net\/v1\.0\/M1\/insights/,
      { data: [{ name: "views", values: [{ value: 300 }] }, { name: "likes", values: [{ value: 12 }] }, { name: "replies", total_value: { value: 3 } }] },
    ],
    ["GET", /graph\.threads\.net\/v1\.0\/M2\/insights/, () => ({ status: 403, json: { error: { message: "Application does not have permission threads_manage_insights" } } })],
  ]);
  try {
    const r = await PLATFORMS.threads.fetchMetrics!(ctx({ credentials: { accessToken: "AT" } }), [
      { postId: "M1", publishedAt: new Date() },
      { postId: "M2", publishedAt: new Date() },
    ]);
    assert.deepEqual(r.M1, { views: 300, likes: 12, replies: 3 });
    assert.match((r.M2 as { error: string }).error, /threads_manage_insights/);
    assert.match(new URL(m.calls[0].url).searchParams.get("metric")!, /views,likes,replies,reposts,quotes,shares/);
  } finally {
    m.restore();
  }
});

test("Threads: 引用投稿はコンテナ作成時に quote_post_id、認可にインサイト権限", async () => {
  const url = new URL(PLATFORMS.threads.oauth!.authorizeUrl({ appId: "a", appSecret: "s" }, { redirectUri: "https://r/cb", state: "st", system: ctx().system }));
  assert.match(url.searchParams.get("scope")!, /threads_manage_insights/);
  const m = mockFetch([
    ["POST", /\/v1\.0\/U1\/threads$/, { id: "C1" }],
    ["GET", /\/v1\.0\/C1\?/, { status: "FINISHED" }],
    ["POST", /\/v1\.0\/U1\/threads_publish$/, { id: "P1" }],
    ["GET", /\/v1\.0\/P1\?/, { permalink: "https://www.threads.net/@y/post/P1" }],
  ]);
  try {
    await PLATFORMS.threads.publish!(ctx({ credentials: { accessToken: "AT", userId: "U1" } }), { text: "同感です", media: [], options: {}, quotePostId: "Q1" });
    assert.equal(m.calls[0].form!.quote_post_id, "Q1");
    assert.equal(m.calls[0].form!.media_type, "TEXT");
  } finally {
    m.restore();
  }
});
