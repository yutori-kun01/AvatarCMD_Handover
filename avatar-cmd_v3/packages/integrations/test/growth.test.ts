// 成長アルゴリズム: 帯・到達レベル・ループの設定値・自動調整（純粋関数）と、DB を使った評価・改善処理・トピック選び
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";
import {
  bandLabel,
  bandOf,
  chooseTopic,
  estimateSettleDays,
  evaluateGrowth,
  GROWTH_BANDS,
  INITIAL_TUNING,
  levelOf,
  loopParams,
  mergeArms,
  sampleBeta,
  stageOf,
  type GrowthInput,
  type GrowthPost,
} from "../src/service/growth";
import { extractPerformance, growthIntervalDays, type PerfRow } from "../src/service/improvement";

const DAY = 86400_000;
/** 再現できる乱数 */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("帯: 決めた区切りで分け、境界の近くでは前の帯にとどまる", () => {
  const v = GROWTH_BANDS.views;
  assert.deepEqual([0, 99, 100, 499, 500, 1999, 2000, 9999, 10_000, 29_999, 30_000, 300_000, 999_999, 1_000_000, 5_000_000, 10_000_000, 9e9].map((x) => bandOf(x, v)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 7, 8, 9, 10, 10]);
  assert.equal(GROWTH_BANDS.views.length, 11);
  assert.equal(GROWTH_BANDS.followers.length, 11);
  assert.equal(GROWTH_BANDS.engagementRate.length, 8);
  // 500 をわずかに越えただけでは 100〜500 にとどまる（8% = 540 から上がる）
  assert.equal(bandOf(520, v, 1), 1);
  assert.equal(bandOf(540, v, 1), 2);
  // 下がるときも同じ（500 の 8% 下 = 460 まではとどまる）
  assert.equal(bandOf(470, v, 2), 2);
  assert.equal(bandOf(459, v, 2), 1);
  // 大きく動いたら複数の帯をまとめて移る
  assert.equal(bandOf(50_000, v, 1), 5);
  assert.equal(bandOf(50, v, 5), 0);
  assert.equal(bandLabel("views", 2), "500〜2,000");
  assert.equal(bandLabel("views", 10), "1,000万〜");
  assert.equal(bandLabel("followers", 7), "1万〜3万");
  assert.equal(bandLabel("engagementRate", 7), "40%〜");
  assert.equal(bandLabel("engagementRate", 1), "1%〜3%");
});

test("到達レベルと段階: 表示回数とフォロワーの帯の位置から", () => {
  const m = (medianViews: number | null, followers: number | null) => ({ posts: 10, medianViews, followers, engagementRate: null, followRate: null, spreadRate: null });
  assert.equal(levelOf(m(0, 0)), 0);
  assert.equal(stageOf(levelOf(m(30, 40))), "seed");
  assert.equal(stageOf(levelOf(m(800, 700))), "sprout");
  assert.equal(stageOf(levelOf(m(15_000, 8_000))), "growth");
  assert.equal(stageOf(levelOf(m(400_000, 80_000))), "established");
  assert.equal(stageOf(levelOf(m(20_000_000, 2_000_000))), "scale");
  // フォロワーが取れない媒体は表示回数だけ
  assert.equal(levelOf(m(2_000, null)), 3);
  // 帯の中でも単調に増える
  assert.ok(levelOf(m(1_500, 900)) > levelOf(m(600, 600)));
});

test("ループの設定値: 初期ほど短い間隔・小さい母数・探索多め・自動適用なし。温度で探索が変わる", () => {
  const t = { ...INITIAL_TUNING, baselineViews: 40, evaluations: 3 };
  const seed = loopParams("x", 0.5, t);
  const big = loopParams("x", 8, { ...t, baselineViews: 200_000 });
  assert.deepEqual(seed.intervalDays, [6, 11]);
  assert.deepEqual(big.intervalDays, [14, 27]);
  assert.equal(seed.minViews, 12); // ふつう 40 の 3 割
  assert.equal(big.minViews, 60_000);
  assert.equal(seed.minGroupPosts, 3);
  assert.equal(big.minGroupPosts, 6);
  assert.ok(seed.exploration > big.exploration);
  assert.equal(seed.allowAutoApply, false);
  assert.equal(big.allowAutoApply, true);
  assert.equal(loopParams("x", 8, { ...t, evaluations: 1 }).allowAutoApply, false); // 評価が 2 回未満は自動適用しない
  // 初期は到達・フォローを重く、反応率を軽く
  assert.ok(seed.weights.reach > big.weights.reach && seed.weights.engagement < big.weights.engagement);
  const w = seed.weights;
  assert.ok(Math.abs(w.reach + w.engagement + w.spread + w.follow - 1) < 1e-9);
  // 媒体ごとの初期値: 指標が出そろう日数
  assert.equal(loopParams("x", 1, t).minObservedDays, 2);
  assert.equal(loopParams("youtube", 1, t).minObservedDays, 7);
  assert.equal(loopParams("youtube", 1, { ...t, settleDays: 3 }).minObservedDays, 3); // 実測があればそちら
  // 温度が高いほど探索が増える
  assert.ok(loopParams("x", 3, { ...t, temperature: 2 }).exploration > loopParams("x", 3, { ...t, temperature: 0.5 }).exploration);
});

function input(now: Date, opts: { views: number; posts?: number; rate?: number; topics?: string[]; followers?: number; startFollowers?: number; ageDays?: number }): GrowthInput {
  const n = opts.posts ?? 10;
  const posts: GrowthPost[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    publishedAt: new Date(now.getTime() - ((opts.ageDays ?? 5) + i) * DAY),
    observedAt: now,
    views: opts.views,
    engagements: Math.round(opts.views * (opts.rate ?? 0.03)),
    spreads: Math.round(opts.views * 0.004),
    topic: opts.topics?.[i % opts.topics.length],
  }));
  return { platform: "x", followers: opts.followers ?? 300, followersAtStart: opts.startFollowers ?? 250, periodViews: null, posts };
}

test("自動調整: 伸びれば探索を減らし、停滞が続けば・下がれば探索を増やす。基準値は自分の「ふつう」に追従", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  let s = evaluateGrowth(input(now, { views: 200 }), { tuning: INITIAL_TUNING, arms: {} }, now);
  assert.equal(s.phase.trend, "new");
  assert.equal(s.tuning.baselineViews, 200);
  assert.equal(s.phase.labels.views, "100〜500");
  assert.equal(s.phase.labels.followers, "100〜500");
  assert.equal(s.phase.labels.engagementRate, "3%〜5%");
  assert.equal(s.phase.metrics.followRate, 50 / 2000); // 増えた 50 人 / 表示 2,000 回
  const t0 = s.tuning.temperature;

  // 表示回数が 2 倍 → 伸び。探索の温度が下がる
  // 7 日たつまでは伸びを判定しない（毎日の評価どうしは期間がほぼ重なるため）
  const early = evaluateGrowth(input(new Date(now.getTime() + DAY), { views: 400, followers: 400 }), { tuning: s.tuning, arms: s.arms, prevBands: s.phase.bands }, new Date(now.getTime() + DAY));
  assert.equal(early.phase.trend, "new");
  assert.equal(early.tuning.temperature, t0);
  assert.equal(early.tuning.ref!.at, s.tuning.ref!.at);
  const d1 = new Date(now.getTime() + 7 * DAY);
  s = evaluateGrowth(input(d1, { views: 400, followers: 400 }), { tuning: s.tuning, arms: s.arms, prevBands: s.phase.bands }, d1);
  assert.equal(s.phase.trend, "up");
  assert.ok(s.tuning.temperature < t0);
  assert.ok(s.tuning.baselineViews! > 200 && s.tuning.baselineViews! < 400); // 指数移動平均
  const tUp = s.tuning.temperature;

  // 同じ値が続く → 停滞。2 回目から温度が上がる
  const d2 = new Date(d1.getTime() + 7 * DAY);
  s = evaluateGrowth(input(d2, { views: 400, followers: 400 }), { tuning: s.tuning, arms: s.arms, prevBands: s.phase.bands }, d2);
  assert.equal(s.phase.trend, "flat");
  assert.equal(s.tuning.temperature, tUp);
  // 間の評価は直近の判定を引き継ぎ、温度は変えない
  const mid = evaluateGrowth(input(new Date(d2.getTime() + 3 * DAY), { views: 400, followers: 400 }), { tuning: s.tuning, arms: s.arms, prevBands: s.phase.bands }, new Date(d2.getTime() + 3 * DAY));
  assert.equal(mid.phase.trend, "flat");
  assert.equal(mid.tuning.temperature, s.tuning.temperature);
  assert.equal(mid.tuning.stagnation, s.tuning.stagnation);
  const d3 = new Date(d2.getTime() + 7 * DAY);
  s = evaluateGrowth(input(d3, { views: 400, followers: 400 }), { tuning: s.tuning, arms: s.arms, prevBands: s.phase.bands }, d3);
  assert.equal(s.tuning.stagnation, 2);
  assert.ok(s.tuning.temperature > tUp);
  assert.ok(s.changes.some((c) => c.includes("探索の割合") && c.includes("停滞")));

  // 大きく下がる → 下降。温度がさらに上がる（上限 2）
  const d4 = new Date(d3.getTime() + 7 * DAY);
  const before = s.tuning.temperature;
  s = evaluateGrowth(input(d4, { views: 60, followers: 400 }), { tuning: s.tuning, arms: s.arms, prevBands: s.phase.bands }, d4);
  assert.equal(s.phase.trend, "down");
  assert.ok(s.tuning.temperature > before && s.tuning.temperature <= 2);
  assert.ok(s.changes.some((c) => c.includes("表示回数の帯が 100〜500 → 0〜100 に下がりました")));
});

test("ノイズの幅: 投稿が少ないほど広く、小さな変化は停滞とみなす", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const a = evaluateGrowth(input(now, { views: 100, posts: 2 }), { tuning: INITIAL_TUNING, arms: {} }, now);
  const b = evaluateGrowth(input(now, { views: 100, posts: 30 }), { tuning: INITIAL_TUNING, arms: {} }, now);
  assert.ok(a.phase.tolerance > b.phase.tolerance);
  const d1 = new Date(now.getTime() + 7 * DAY);
  const c = evaluateGrowth(input(d1, { views: 115, posts: 2 }), { tuning: a.tuning, arms: a.arms }, d1);
  assert.equal(c.phase.trend, "flat"); // 2 件で +15% は誤差の範囲
});

test("トピックの成績: 出そろった投稿だけを 1 回ずつ数え、評価のたびに少しずつ忘れる。margin は上位 4 割に追従", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const posts: GrowthPost[] = [];
  for (let i = 0; i < 12; i++) {
    const good = i % 3 === 0;
    posts.push({ id: `p${i}`, publishedAt: new Date(now.getTime() - (3 + i) * DAY), observedAt: now, views: good ? 900 : 150, engagements: good ? 60 : 3, spreads: good ? 9 : 0, topic: good ? "朝のルーティン" : "集中のコツ" });
  }
  // 公開したばかり（出そろっていない）の投稿は数えない
  posts.push({ id: "young", publishedAt: new Date(now.getTime() - 0.5 * DAY), observedAt: now, views: 5000, engagements: 500, spreads: 50, topic: "新トピック" });
  const inp: GrowthInput = { platform: "x", followers: 200, followersAtStart: 190, periodViews: null, posts };
  const r = evaluateGrowth(inp, { tuning: INITIAL_TUNING, arms: {} }, now);
  assert.ok(r.arms["朝のルーティン"].a > r.arms["朝のルーティン"].b);
  assert.ok(r.arms["集中のコツ"].b > r.arms["集中のコツ"].a);
  assert.equal(r.arms["新トピック"], undefined);
  assert.ok(r.tuning.margin !== 0);
  // 同じ投稿で再評価しても二重に数えない（忘却で少し減るだけ）
  const later = new Date(now.getTime() + DAY / 4);
  const r2 = evaluateGrowth(inp, { tuning: r.tuning, arms: r.arms }, later);
  assert.ok(r2.arms["朝のルーティン"].a < r.arms["朝のルーティン"].a);
  assert.ok(r2.arms["朝のルーティン"].a > 1);
});

test("出そろう日数: 時点ごとの表示回数から推定する", () => {
  const mk = (cps: [number, number][], views: number): GrowthPost => ({ id: "x", publishedAt: new Date(0), observedAt: new Date(0), views, engagements: 0, spreads: 0, checkpoints: cps.map(([h, v]) => ({ h, views: v })) });
  const fast = [mk([[1, 300], [6, 800], [24, 950]], 1000), mk([[1, 200], [6, 600], [24, 900]], 1000), mk([[1, 100], [6, 900], [24, 990]], 1000)];
  assert.equal(estimateSettleDays(fast), 1); // 24 時間で 9 割以上
  const slow = [mk([[24, 200], [72, 600], [168, 950]], 1000), mk([[24, 100], [72, 500], [168, 900]], 1000), mk([[24, 300], [72, 700], [168, 980]], 1000)];
  assert.equal(estimateSettleDays(slow), 7);
  assert.equal(estimateSettleDays(fast.slice(0, 2)), null); // 件数が足りない
});

test("トピック選び: 探索では試した回数が少ないもの、活用では成績の良いものを選ぶ", () => {
  const arms = { A: { a: 9, b: 2 }, B: { a: 2, b: 9 }, C: { a: 1, b: 1 } };
  // 探索 0: ほぼ A（トンプソンサンプリング）
  const rng = seeded(7);
  const picks = Array.from({ length: 200 }, () => chooseTopic(["A", "B", "C"], arms, 0, rng).topic);
  assert.ok(picks.filter((x) => x === "A").length > 120);
  assert.ok(picks.filter((x) => x === "B").length < 20);
  // 探索 1: 試していない C
  const e = chooseTopic(["A", "B", "C"], arms, 1, seeded(3));
  assert.deepEqual(e, { topic: "C", explored: true });
  assert.equal(chooseTopic(["only"], arms, 1).topic, "only");
  // ベータ分布の平均
  const r2 = seeded(11);
  const mean = Array.from({ length: 4000 }, () => sampleBeta(3, 7, r2)).reduce((s, v) => s + v, 0) / 4000;
  assert.ok(Math.abs(mean - 0.3) < 0.02);
  assert.deepEqual(mergeArms([{ A: { a: 3, b: 2 } }, { A: { a: 2, b: 4 }, B: { a: 2, b: 1 } }]), { A: { a: 4, b: 5 }, B: { a: 2, b: 1 } });
});

test("改善処理: 媒体ごとの成長フェーズの条件で比較し、間隔はいちばん初期の媒体に合わせる", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const rows: PerfRow[] = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, platform: "threads", format: "automation", text: "x", publishedAt: new Date(now.getTime() - 3 * DAY), observedAt: now, views: 20 + i, engagements: 2 }));
  // 既定の条件（表示 50 回・7 日・5 件）では比較できない
  assert.equal(extractPerformance(rows).groups.length, 0);
  // 初期のアカウントの条件なら比較できる
  const g = extractPerformance(rows, { threads: { minViews: 10, minObservedDays: 2, minGroupPosts: 3 } });
  assert.equal(g.groups.length, 1);
  assert.equal(g.groups[0].posts, 4);
  assert.equal(growthIntervalDays({}, () => 0), 14);
  assert.equal(growthIntervalDays({ x: { intervalDays: [6, 10] }, youtube: { intervalDays: [14, 27] } }, () => 0), 6);
  assert.equal(growthIntervalDays({ x: { intervalDays: [6, 10] }, youtube: { intervalDays: [14, 27] } }, () => 0.999), 10);
});

// --- DB ------------------------------------------------------------------------------------

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };
let svc: typeof import("../src/server");
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let accountId = "";
const TOUCHED = ["anthropic_api_key"];
let saved: { key: string; value: string; secret: boolean }[] = [];

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `growth-${tag}@example.com` } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `成長-${tag}` } })).id;
  const acc = await svc.saveConnectedAccount(avatarId, "threads", { accountId: `g${tag}`, accountName: "@grow", credentials: { accessToken: "AT", expiresAt: new Date(Date.now() + 86400_000).toISOString() } });
  accountId = acc.id;
  await prisma.snsAccount.update({ where: { id: accountId }, data: { followerCount: 80 } });
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.$disconnect();
});

test("DB: 評価して保存し、初期のアカウントでは改善案を自動適用しない。トピックは成績で選ぶ", opts, async () => {
  const now = new Date();
  const goodIds: string[] = [];
  for (let i = 0; i < 8; i++) {
    const good = i % 2 === 0;
    const c = await prisma.content.create({
      data: {
        avatarId,
        platform: "threads",
        snsAccountId: accountId,
        content: `投稿${i}`,
        status: "PUBLISHED",
        category: "automation",
        publishedAt: new Date(now.getTime() - (3 + i) * DAY),
        metadata: { title: good ? "当たり" : "はずれ" },
        engagement: { views: good ? 80 : 20, engagements: good ? 8 : 0, replies: good ? 4 : 0, reposts: good ? 1 : 0, fetchedAt: now.toISOString() },
        metricsUpdatedAt: now,
      },
    });
    if (good) goodIds.push(c.id);
  }
  assert.equal(await svc.processGrowth(now), 1);
  assert.equal(await svc.processGrowth(now), 0); // 1 日 1 回
  const g = (await svc.growthOf(accountId))!;
  assert.equal(g.phase.stage, "seed");
  assert.equal(g.phase.labels.followers, "0〜100");
  assert.equal(g.phase.params.allowAutoApply, false);
  assert.ok(g.arms["当たり"].a > g.arms["はずれ"].a);

  const params = await svc.growthParamsForAvatar(avatarId);
  assert.ok(params.threads.minViews < 50);

  // 改善処理（自動適用モード）: 初期の条件で比較でき、自動適用はしない
  await svc.saveImprovementSchedule(avatarId, { mode: "auto" });
  const before = await prisma.knowledgeItem.count({ where: { avatarId } });
  const m = mockFetch([
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => ({
        text: claudeSse(
          c.json.model,
          JSON.stringify({ learnings: [{ title: "当たりの型", summary: "具体例から始める", platforms: ["threads"], evidencePostIds: goodIds }], ruleSuggestions: [], observations: [] })
        ),
        headers: { "content-type": "text/event-stream" },
      }),
    ],
  ]);
  try {
    await svc.setSetting("anthropic_api_key", "ak-test");
    const cycle = await svc.runImprovementNow(avatarId);
    const analysis = cycle.analysis as any;
    assert.ok(analysis.growth.threads);
    // 既定の条件（50 回・7 日・5 件）では比較できない投稿でも、初期の条件で比較できる
    assert.equal(analysis.extraction.groups.length, 1);
    assert.equal(cycle.status, "pending"); // 改善案は承認待ち
    assert.equal(await prisma.knowledgeItem.count({ where: { avatarId } }), before); // 自動適用していない
  } finally {
    m.restore();
  }

  // トピック選び: growth にすると成績の良い「当たり」が多く選ばれる
  const action = { accountIds: [accountId], topics: ["当たり", "はずれ"], mode: "draft" as const, topicStrategy: "growth" as const };
  const rng = seeded(5);
  let hits = 0;
  for (let i = 0; i < 60; i++) if ((await svc.pickTopic(action, [accountId], i, rng)).topic === "当たり") hits++;
  assert.ok(hits > 35, `当たり ${hits}/60`);
  // rotate（既定）は順番
  assert.equal((await svc.pickTopic({ ...action, topicStrategy: undefined }, [accountId], 3)).topic, "はずれ");
});
