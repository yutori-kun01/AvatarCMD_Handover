// X API の利用方針（モード・カスタマイズ）・予算による段階的な縮小・指標の時点取得
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch } from "./helpers";
import { candidateScore } from "../src/service/quotes";
import { degrade, dueCheckpoint, estimateXMonthly, lastScanSlot, normalizeParams, normalizeSetting, paramsOf, scanDue, X_MODES } from "../src/service/x-policy";

test("モード: 既定は BALANCED。カスタマイズは範囲内に丸め、無い項目は BALANCED の値", () => {
  const d = normalizeSetting(null);
  assert.equal(d.mode, "balanced");
  assert.deepEqual(paramsOf(d), X_MODES.balanced.params);
  assert.deepEqual([d.degradeAtYen, d.capYen], [800, 1000]);
  const c = normalizeSetting({ mode: "custom", custom: { metricsCheckpoints: [24, 2, 2, 0, 999], scanTimes: ["07:30", "25:00", "07:30", "21:00"], scanPosts: 500 } as any, degradeAtYen: 5000, capYen: 1500 });
  assert.deepEqual(c.custom.metricsCheckpoints, [2, 24, 336]);
  assert.deepEqual(c.custom.scanTimes, ["07:30", "21:00"]);
  assert.equal(c.custom.scanPosts, 100);
  assert.equal(c.custom.shortlist, X_MODES.balanced.params.shortlist);
  assert.equal(c.degradeAtYen, 1500); // 上限を超えない
  assert.equal(normalizeSetting({ mode: "nope" as any }).mode, "balanced");
  assert.deepEqual(normalizeParams({ scanTimes: [] }).scanTimes, []); // 探索なしも選べる
});

test("見積もり: 1 日 2 投稿で ECO < BALANCED（約 $6）< AGGRESSIVE", () => {
  const e = estimateXMonthly(X_MODES.eco.params);
  const b = estimateXMonthly(X_MODES.balanced.params);
  const a = estimateXMonthly(X_MODES.aggressive.params);
  assert.equal(b.postReads, 2 * 30 * 3 + 2 * 12 * 30);
  assert.equal(b.creates, 60 + 20);
  assert.ok(b.usd > 5.5 && b.usd < 6.5, `BALANCED ${b.usd}`);
  assert.ok(e.usd < b.usd && b.usd < a.usd);
  assert.ok(b.yen > 850 && b.yen < 1000);
});

test("縮小: 80% で探索 1 回・10 件・指標は後ろ 2 時点、100% で探索と引用を止める", () => {
  const p = X_MODES.balanced.params;
  assert.deepEqual(degrade(p, "normal"), p);
  const r = degrade(p, "reduced");
  assert.deepEqual([r.scanTimes, r.scanPosts, r.metricsCheckpoints], [["08:00"], 10, [6, 24]]);
  const s = degrade(p, "stopped");
  assert.deepEqual([s.scanTimes, s.quotesPerMonth, s.metricsCheckpoints], [[], 0, [6, 24]]);
});

test("時刻と時点: 探索は決まった時刻を過ぎたときだけ。指標は過ぎた最後の時点を 1 回だけ", () => {
  const now = new Date("2026-10-06T00:30:00Z"); // 9:30 JST
  assert.equal(lastScanSlot(["08:00", "18:00"], now)!.toISOString(), "2026-10-05T23:00:00.000Z");
  assert.equal(lastScanSlot(["10:00"], now)!.toISOString(), "2026-10-05T01:00:00.000Z"); // 前日の 10:00
  assert.equal(scanDue(["08:00", "18:00"], new Date("2026-10-05T22:00:00Z"), now), true);
  assert.equal(scanDue(["08:00", "18:00"], new Date("2026-10-05T23:10:00Z"), now), false);
  assert.equal(scanDue([], null, now), false);
  const pub = new Date("2026-10-05T00:00:00Z");
  const at = (h: number) => new Date(pub.getTime() + h * 3600_000);
  assert.equal(dueCheckpoint(pub, [], [1, 6, 24], at(0.5)), null);
  assert.equal(dueCheckpoint(pub, [], [1, 6, 24], at(2)), 1);
  assert.equal(dueCheckpoint(pub, [1], [1, 6, 24], at(5)), null);
  assert.equal(dueCheckpoint(pub, [1], [1, 6, 24], at(30)), 24); // 止まっていた間の 6h はさかのぼらない
  assert.equal(dueCheckpoint(pub, [1, 24], [1, 6, 24], at(40)), null);
});

test("引用候補の採点: ジャンルが近く・反応があり・新しい投稿が上", () => {
  const now = new Date("2026-10-06T00:00:00Z");
  const base = { id: "1", url: "", kind: "original" as const, createdAt: "2026-10-05T23:00:00Z" };
  const onTopic = candidateScore({ ...base, text: "集中力を上げる朝の習慣", metrics: { likes: 10 } }, ["集中力", "習慣"], now);
  const offTopic = candidateScore({ ...base, text: "今日のランチ", metrics: { likes: 10 } }, ["集中力", "習慣"], now);
  const old = candidateScore({ ...base, text: "集中力を上げる朝の習慣", metrics: { likes: 10 }, createdAt: "2026-10-04T00:00:00Z" }, ["集中力", "習慣"], now);
  assert.ok(onTopic > offTopic && onTopic > old);
});

// --- DB ---------------------------------------------------------------------------

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let accId = "";

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `xpolicy-${tag}@example.com` } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `X-${tag}` } })).id;
  const cred = { accessToken: "AT", username: "me", expiresAt: new Date(Date.now() + 86400_000).toISOString() };
  accId = (await svc.saveConnectedAccount(avatarId, "x", { accountId: `90${tag}`, accountName: "@x", credentials: cred })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.usageLedger.deleteMany({ where: { avatarId } });
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

test("指標: X は決まった時点の投稿だけ ids 指定で読み、時点ごとに記録する", opts, async () => {
  const now = Date.now();
  const mk = (hoursAgo: number, ext: string) =>
    prisma.content.create({ data: { avatarId, platform: "x", snsAccountId: accId, content: "x", status: "PUBLISHED", publishedAt: new Date(now - hoursAgo * 3600_000), externalPostId: ext } });
  await mk(0.5, "A"); // まだ 1h 前
  const b = await mk(2, "B"); // 1h の時点
  const c = await mk(30, "C"); // 24h の時点（6h はさかのぼらない）
  const m = mockFetch([
    ["GET", /\/2\/tweets\?/, (call) => ({ json: { data: new URL(call.url).searchParams.get("ids")!.split(",").map((id) => ({ id, public_metrics: { impression_count: 100, like_count: 3 } })) } })],
  ]);
  try {
    await svc.collectMetrics();
    const reads = m.calls.filter((x) => /\/2\/tweets\?/.test(x.url));
    assert.equal(reads.length, 1);
    assert.deepEqual(new URL(reads[0].url).searchParams.get("ids")!.split(",").sort(), ["B", "C"]);
    const snaps = await prisma.postMetricSnapshot.findMany({ where: { contentId: { in: [b.id, c.id] } }, orderBy: { checkpoint: "asc" } });
    assert.deepEqual(snaps.map((s) => [s.contentId === b.id ? "B" : "C", s.checkpoint, s.views]), [["B", 1, 100], ["C", 24, 100]]);
    // もう一度動かしても、新しい時点が来るまで読まない
    await svc.collectMetrics();
    assert.equal(m.calls.filter((x) => /\/2\/tweets\?/.test(x.url)).length, 1);
    const ledger = await prisma.usageLedger.findMany({ where: { avatarId, purpose: "x_metrics" } });
    assert.equal(ledger.reduce((s, r) => s + r.reads, 0), 2);
  } finally {
    m.restore();
  }
});

test("予算: 今月の X 費用で縮小・停止し、停止中は引用探索を読まない。カスタマイズの保存", opts, async () => {
  const saved = await svc.saveXPolicy(avatarId, { mode: "custom", custom: { scanTimes: ["06:00"], scanPosts: 15 } as any, degradeAtYen: 100, capYen: 200 });
  assert.equal(saved.mode, "custom");
  assert.deepEqual(saved.custom.scanTimes, ["06:00"]);
  let e = await svc.effectiveXPolicy(avatarId);
  assert.equal(e.level, "normal");
  // 100 円を超える読み取り（$0.005 × 150 件 × 158 円 ≒ 118 円）
  await prisma.usageLedger.create({ data: { provider: "x", purpose: "x_timeline", avatarId, reads: 150 } });
  e = await svc.effectiveXPolicy(avatarId);
  assert.equal(e.level, "reduced");
  assert.equal(e.params.scanPosts, 10);
  assert.equal(e.usage.postReads, 2 + 150);
  await prisma.usageLedger.create({ data: { provider: "x", purpose: "x_profile", avatarId, reads: 60 } }); // User Read 60 件 ≒ 95 円
  e = await svc.effectiveXPolicy(avatarId);
  assert.equal(e.level, "stopped");
  assert.equal(e.usage.userReads, 60);
  const m = mockFetch([["GET", /timelines/, { data: [] }]]);
  try {
    await assert.rejects(svc.scanQuoteCandidates(accId), /上限 ¥200 に達した/);
    assert.equal(m.calls.length, 0);
  } finally {
    m.restore();
  }
  // 予算を上げれば再開。決まった時刻を過ぎていなければ（直後の 2 回目）読まない
  await svc.saveXPolicy(avatarId, { capYen: 100000, degradeAtYen: 100000 });
  const m2 = mockFetch([["GET", /timelines/, { data: [] }]]);
  try {
    const r1 = await svc.scanQuoteCandidates(accId, { scheduled: true });
    assert.equal(r1.waiting, undefined);
    assert.equal(new URL(m2.calls[0].url).searchParams.get("max_results"), "15");
    const r2 = await svc.scanQuoteCandidates(accId, { scheduled: true });
    assert.match(r2.waiting!, /次の探索時刻/);
    assert.equal(m2.calls.length, 1);
  } finally {
    m2.restore();
  }
});
