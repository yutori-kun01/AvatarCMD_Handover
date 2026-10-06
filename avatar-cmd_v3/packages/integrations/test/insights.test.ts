// 指標の推移（timeseries）・閲覧数の記録・プロフィール画像 → アバターのアイコン
// DB を使うテストは AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI の使い捨て Postgres で有効）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { followerSeries, lastDays, pctChange } from "../src/service/timeseries";
import { metricsDelta } from "../src/service/metrics";

test("フォロワーの日別合計: 記録の無い日は直前の値を引き継ぎ、前日比はアカウントごとの差の合計", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  const r = followerSeries(
    [
      { accountId: "a", date: "2026-09-30", followers: 100 },
      { accountId: "a", date: "2026-10-02", followers: 110 },
      // b は 10/2 から記録開始（開始日の前日比は数えない）
      { accountId: "b", date: "2026-10-02", followers: 50 },
      { accountId: "b", date: "2026-10-03", followers: 48 },
    ],
    days
  );
  assert.deepEqual(r.followers, [100, 160, 158]);
  assert.deepEqual(r.delta, [0, 10, -2]);
  assert.deepEqual(followerSeries([], days), { followers: [null, null, null], delta: [null, null, null] });
});

test("日付・前期比・指標の増分", () => {
  const d = lastDays(3, new Date("2026-10-05T16:00:00Z")); // 10/6 1:00 JST
  assert.deepEqual(d, ["2026-10-04", "2026-10-05", "2026-10-06"]);
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(5, 0), null);
  assert.equal(pctChange(null, 3), null);
  assert.deepEqual(metricsDelta({ views: 100, engagements: 5 }, { views: 160, engagements: 4 }), { views: 60, engagements: 0 });
  assert.deepEqual(metricsDelta({}, { views: 30, engagements: 2 }), { views: 30, engagements: 2 });
});

// --- DB ---------------------------------------------------------------------------

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let xId = "";
let threadsId = "";

before(async () => {
  if (!hasDb) return;
  process.env.MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "avatar-media-"));
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `insights-test-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `推移-${tag}` } })).id;
  xId = (await prisma.snsAccount.create({ data: { avatarId, platform: "x", authType: "oauth", accountName: `x-${tag}`, accountId: `x${tag}` } })).id;
  threadsId = (await prisma.snsAccount.create({ data: { avatarId, platform: "threads", authType: "oauth", accountName: `th-${tag}`, accountId: `t${tag}` } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

const png = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed]);
const fakeFetch = (bytes: Uint8Array, type = "image/png") => (async () => new Response(Buffer.from(bytes), { headers: { "content-type": type } })) as unknown as typeof fetch;

test("プロフィール画像: X を優先してアイコンにし、手動設定は上書きしない。同じ画像は保存し直さない", opts, async () => {
  const th = await svc.saveProfileImage(threadsId, "https://cdn.example.com/t.png", fakeFetch(png(1)));
  assert.match(th!, /^\/media\/[a-f0-9-]{36}\.png$/);
  assert.equal((await prisma.avatar.findUniqueOrThrow({ where: { id: avatarId } })).avatarImageUrl, th);

  const x = await svc.saveProfileImage(xId, "https://pbs.example.com/x.png", fakeFetch(png(2)));
  let av = await prisma.avatar.findUniqueOrThrow({ where: { id: avatarId } });
  assert.equal(av.avatarImageUrl, x);
  assert.equal(av.avatarImageSource, `account:${xId}`);

  assert.equal(await svc.saveProfileImage(xId, "https://pbs.example.com/x.png", fakeFetch(png(2))), null);
  await assert.rejects(svc.saveProfileImage(xId, "http://insecure.example.com/x.png", fakeFetch(png(3))), /https/);
  await assert.rejects(svc.saveProfileImage(xId, "https://pbs.example.com/x.svg", fakeFetch(png(3), "image/svg+xml")), /形式/);

  await svc.setAvatarIcon(avatarId, th!.replace("/media/", ""));
  await svc.saveProfileImage(xId, "https://pbs.example.com/x2.png", fakeFetch(png(4)));
  av = await prisma.avatar.findUniqueOrThrow({ where: { id: avatarId } });
  assert.equal(av.avatarImageUrl, th);
  assert.equal(av.avatarImageSource, "manual");

  // 自動に戻すと X の最新画像
  const back = await svc.setAvatarIcon(avatarId, null);
  assert.equal(back, (await prisma.snsAccount.findUniqueOrThrow({ where: { id: xId } })).profileImageUrl);
});

test("閲覧数: 日別値・累計の差分・投稿の増分を記録し、timeseries で期間比較できる", opts, async () => {
  const now = new Date("2026-10-06T03:00:00Z"); // 10/6 12:00 JST
  // Threads: 日別の閲覧数（API）
  await svc.saveInsights(threadsId, { daily: [{ date: "2026-10-05", views: 300 }, { date: "2026-10-06", views: 100 }] }, now);
  // X: 投稿ごとの増分
  await svc.addPostDeltas(xId, { views: 200, engagements: 10 }, now);
  await svc.addPostDeltas(xId, { views: 50, engagements: 2 }, now);
  // 累計の差分（初回は累計だけ、翌日に差分）
  await svc.saveInsights(xId, { totals: { views: 1000 } }, new Date("2026-10-04T03:00:00Z"));
  await svc.saveInsights(xId, { totals: { views: 1300 } }, new Date("2026-10-05T03:00:00Z"));
  const snapX5 = await prisma.accountSnapshot.findFirstOrThrow({ where: { snsAccountId: xId, date: new Date("2026-10-05T00:00:00Z") } });
  assert.equal(snapX5.views, 300);
  assert.equal(snapX5.source, "cumulative_diff");

  // フォロワー
  await svc.saveProfileStats(xId, { followers: 1000 }, new Date("2026-09-20T03:00:00Z"));
  await svc.saveProfileStats(xId, { followers: 1010 }, new Date("2026-10-05T03:00:00Z"));
  await svc.saveProfileStats(threadsId, { followers: 500 }, new Date("2026-10-06T03:00:00Z"));

  const t = await svc.timeseries({ range: "7d", avatarId, now });
  assert.deepEqual(t.days.at(-1), "2026-10-06");
  const d6 = t.daily.at(-1)!;
  assert.equal(d6.views, 350); // Threads 100 + X 250
  assert.equal(d6.engagements, 12);
  assert.equal(d6.engagementRate, 12 / 350);
  assert.equal(d6.followers, 1510);
  const d5 = t.daily.at(-2)!;
  assert.equal(d5.views, 600);
  assert.equal(d5.followersDelta, 10);
  assert.equal(t.totals.followers, 1510);
  assert.equal(t.totals.followersDelta, 10); // Threads は記録開始日なので前日比に含めない
  assert.equal(t.totals.views, 950);
  // アカウント単位
  const only = await svc.timeseries({ range: "7d", accountId: threadsId, now });
  assert.equal(only.totals.views, 400);
  await assert.rejects(async () => svc.parseRange("1y"), /期間/);
});
