// アカウント分析（バイタルチェック）と収益アイテム
// DB を使うテストは AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI の使い捨て Postgres で有効）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { followersDelta, jstDay, monthDays, monthRange, normalizeMonth, shiftMonth, vitalCheck } from "../src/service/analytics";

test("月の計算は日本時間", () => {
  const r = monthRange("2026-09");
  assert.equal(r.start.toISOString(), "2026-08-31T15:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-09-30T15:00:00.000Z");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(monthDays("2026-02").length, 28);
  assert.equal(monthDays("2026-09")[0], "2026-09-01");
  assert.equal(monthDays("2026-09").at(-1), "2026-09-30");
  // 9/30 23:30 JST は 9月、10/1 0:30 JST は 10月
  assert.equal(jstDay(new Date("2026-09-30T14:30:00Z")), "2026-09-30");
  assert.equal(jstDay(new Date("2026-09-30T15:30:00Z")), "2026-10-01");
  assert.equal(normalizeMonth(null, new Date("2026-09-30T15:30:00Z")), "2026-10");
  assert.throws(() => normalizeMonth("2026-13"), /形式/);
});

test("フォロワー増減: 月初より前の最後の記録と月内の最後の記録を比べる", () => {
  const snaps = [
    { date: "2026-08-30", followers: 100 },
    { date: "2026-09-02", followers: 104 },
    { date: "2026-09-20", followers: null },
    { date: "2026-09-28", followers: 110 },
  ];
  assert.deepEqual(followersDelta(snaps, "2026-09"), { start: 100, end: 110, delta: 10 });
  // 前月の記録が無ければ月内の最初の記録から
  assert.deepEqual(followersDelta(snaps.slice(1), "2026-09"), { start: 104, end: 110, delta: 6 });
  assert.deepEqual(followersDelta([], "2026-09"), { start: null, end: null, delta: null });
});

test("バイタルチェック: スコアと状態", () => {
  const base = { isActive: true, lastError: null, posts: 20, failed: 0, tokenExpiresInDays: null, followersDelta: 5, revenue: 1000, prevRevenue: 800, currentMonth: false, dayOfMonth: 15 };
  assert.deepEqual(vitalCheck(base), { level: "good", score: 100, reasons: [] });
  assert.equal(vitalCheck({ ...base, isActive: false }).level, "inactive");

  const failing = vitalCheck({ ...base, posts: 2, failed: 3 });
  assert.equal(failing.level, "error");
  assert.match(failing.reasons[0], /失敗 3件/);

  const some = vitalCheck({ ...base, failed: 1 });
  assert.equal(some.level, "warning");
  assert.ok(some.score < 100);

  assert.equal(vitalCheck({ ...base, lastError: "401" }).level, "error");
  assert.equal(vitalCheck({ ...base, tokenExpiresInDays: 1 }).level, "warning");
  assert.equal(vitalCheck({ ...base, tokenExpiresInDays: -1 }).level, "error");

  // 投稿なし: 過去の月は注意、今月は月初7日間は猶予
  assert.equal(vitalCheck({ ...base, posts: 0 }).level, "warning");
  assert.equal(vitalCheck({ ...base, posts: 0, currentMonth: true, dayOfMonth: 3 }).level, "good");
  assert.match(vitalCheck({ ...base, revenue: 100, prevRevenue: 1000 }).reasons.join(), /収益/);
});

// --- DB ---------------------------------------------------------------------------

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let otherAvatarId = "";
let accountId = "";

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `analytics-test-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `分析-${tag}` } })).id;
  otherAvatarId = (await prisma.avatar.create({ data: { userId, name: `別-${tag}` } })).id;
  accountId = (await prisma.snsAccount.create({ data: { avatarId, platform: "note", authType: "session", accountName: `note-${tag}`, accountId: tag } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

test("収益アイテム: 登録 → 選んで数量だけで記録 → アカウント別の月次に反映", opts, async () => {
  const item = await svc.saveRevenueItem({ avatarId, snsAccountId: accountId, name: "記事『朝の集中ルーティン』", platform: "note", unitPrice: "¥500" });
  assert.equal(item.unitPrice, 500);
  await assert.rejects(svc.saveRevenueItem({ avatarId: otherAvatarId, snsAccountId: accountId, name: "x", platform: "note", unitPrice: 1 }), /このアバターのもの/);

  const now = new Date("2026-09-15T03:00:00Z");
  const r1 = await svc.recordRevenue({ itemId: item.id, quantity: 3, earnedAt: "2026-09-10T03:00:00Z" });
  assert.equal(r1.amount, 1500);
  assert.equal(r1.snsAccountId, accountId);
  assert.equal(r1.platform, "note");
  // 金額の上書き（値引きなど）
  const r2 = await svc.recordRevenue({ itemId: item.id, quantity: 1, amount: "450", earnedAt: "2026-09-12T03:00:00Z" });
  assert.equal(r2.amount, 450);
  // 先月分とアカウント未指定の収益
  await svc.recordRevenue({ itemId: item.id, earnedAt: "2026-08-20T03:00:00Z" });
  await svc.recordRevenue({ avatarId, source: "sponsorship", platform: "X", amount: 10000, earnedAt: "2026-09-05T03:00:00Z" });
  await assert.rejects(svc.recordRevenue({ itemId: item.id, quantity: 0 }), /数量/);

  // フォロワー（手入力）: 前月末と今月
  await svc.saveProfileStats(accountId, { followers: 200 }, new Date("2026-08-31T03:00:00Z"));
  await svc.saveProfileStats(accountId, { followers: 230 }, now);

  const v = await svc.accountVitals({ month: "2026-09", avatarId, now });
  assert.equal(v.month, "2026-09");
  assert.equal(v.prevMonth, "2026-08");
  assert.equal(v.nextMonth, null);
  assert.equal(v.totals.revenue, 11950);
  assert.equal(v.totals.prevRevenue, 500);
  assert.equal(v.totals.unassignedRevenue, 10000);
  const a = v.accounts.find((x) => x.id === accountId)!;
  assert.equal(a.revenue, 1950);
  assert.equal(a.prevRevenue, 500);
  assert.equal(a.followers, 230);
  assert.equal(a.followersDelta, 30);
  assert.equal(a.followersAuto, true); // note もフォロワー数を自動取得する（v3.7）
  assert.equal(a.daily.find((d) => d.date === "2026-09-10")!.revenue, 1500);
  assert.equal(a.daily.find((d) => d.date === "2026-09-15")!.followers, 230);
  assert.deepEqual(a.items, [{ name: "記事『朝の集中ルーティン』", total: 1950, quantity: 4 }]);
  assert.deepEqual(a.revenueTrend.slice(-2), [
    { month: "2026-08", total: 500, posts: 0 },
    { month: "2026-09", total: 1950, posts: 0 },
  ]);
  // 前月の同じ日との比較（8/20 の 500 円）と、今月の未来の日は null（累計線を今日で止める）
  assert.equal(a.daily.find((d) => d.date === "2026-09-20")!.prevRevenue, 500);
  assert.equal(a.daily.find((d) => d.date === "2026-09-20")!.revenue, null);
  assert.equal(v.totals.daily.find((d) => d.date === "2026-09-05")!.revenue, 10000);
  assert.equal(v.totals.daily.find((d) => d.date === "2026-09-20")!.prevRevenue, 500);

  // 前月に戻る（ページャー）
  const prev = await svc.accountVitals({ month: "2026-08", avatarId, now });
  assert.equal(prev.nextMonth, "2026-09");
  assert.equal(prev.accounts[0].revenue, 500);

  const items = await svc.listRevenueItems();
  const listed = items.find((i) => i.id === item.id)!;
  assert.equal(listed.quantity, 5);
  assert.equal(listed.total, 2450);

  // アイテムを消しても記録は残る
  await prisma.revenueItem.delete({ where: { id: item.id } });
  assert.equal((await prisma.revenue.findUniqueOrThrow({ where: { id: r1.id } })).itemId, null);
});
