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
  requiredPosts,
  reviewPolicy,
  batchTolerance,
  mergeArms,
  sampleBeta,
  stageOf,
  type GrowthInput,
  type GrowthPost,
  type GrowthReview,
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

/** 投稿ごとに決まる標準正規乱数（実際の投稿のばらつき σ ≒ 0.45 を再現する） */
function gauss(idx: number) {
  const frac = (x: number) => x - Math.floor(x);
  const u1 = Math.max(1e-9, frac(Math.sin(idx * 12.9898) * 43758.5453));
  const u2 = frac(Math.sin(idx * 78.233) * 12345.6789);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** ppd 件/日のペースで、28 日分さかのぼって投稿を作る。views(at) で公開時刻ごとの表示回数を決める */
function series(now: Date, ppd: number, views: (at: number) => number, opts: { followers?: number; topics?: string[] } = {}): GrowthInput {
  const posts: GrowthPost[] = [];
  const step = DAY / ppd;
  // 時刻の格子は now に依存させない（評価のたびに同じ投稿が同じ時刻にある）
  const last = Math.floor(now.getTime() / step) * step;
  for (let at = last, k = 0; at > now.getTime() - 28 * DAY; at -= step, k++) {
    const idx = Math.round(at / step);
    const v = Math.max(1, Math.round(views(at) * 2 ** (0.45 * gauss(idx))));
    posts.push({ id: `s${idx}`, publishedAt: new Date(at), observedAt: now, views: v, engagements: Math.round(v * 0.03), spreads: Math.round(v * 0.004), topic: opts.topics?.[idx % opts.topics.length] });
  }
  return { platform: "x", followers: opts.followers ?? 300, followersAtStart: 290, periodViews: null, posts };
}

/** T0 から 1 日ごとに評価して、最初に比べた日（T0 からの日数）と結果を返す */
function firstComparison(ppd: number, views: (at: number) => number, startTuning = INITIAL_TUNING, maxDays = 40) {
  const T0 = new Date("2026-09-01T00:00:00Z").getTime();
  let st = { tuning: startTuning, arms: {} as Record<string, { a: number; b: number }> };
  for (let d = 0; d <= maxDays; d++) {
    const now = new Date(T0 + d * DAY);
    const r = evaluateGrowth(series(now, ppd, views), st, now);
    if (r.compared) return { day: d, r };
    st = { tuning: r.tuning, arms: r.arms };
  }
  return null;
}

test("証拠の時計: 必要件数はばらつきと変化幅から。投稿が多いほど早く、少ないほど長く待って比べる", () => {
  // n = (1.64 × σ / δ)²。δ = 15%
  assert.equal(requiredPosts({ sigma: null, paceFactor: 1 }), 14); // σ の初期値 0.45
  assert.equal(requiredPosts({ sigma: 0.9, paceFactor: 1 }), 54); // ばらつきが 2 倍なら 4 倍
  assert.equal(requiredPosts({ sigma: 0.45, paceFactor: 0.5 }), 7);
  assert.equal(requiredPosts({ sigma: 0.05, paceFactor: 1 }), 5); // 下限
  assert.equal(requiredPosts({ sigma: 5, paceFactor: 1 }), 60); // 上限

  const flat = () => 300;
  const high = firstComparison(10, flat)!; // 1 日 10 件
  const daily = firstComparison(1, flat)!; // 1 日 1 件
  const twice = firstComparison(2 / 7, flat)!; // 週 2 件
  const weekly = firstComparison(1 / 7, flat)!; // 週 1 件
  // 多いほど早い。1 日 10 件は下限（出そろう 2 日 + 1 日）で比べる
  assert.equal(high.day, 3);
  assert.ok(high.day < daily.day && daily.day < twice.day && twice.day <= weekly.day, `${high.day} < ${daily.day} < ${twice.day} <= ${weekly.day}`);
  for (const x of [high, daily, twice]) {
    assert.equal(x.r.comparison!.lowConfidence, false);
    assert.ok(x.r.comparison!.current.posts >= x.r.comparison!.requiredPosts);
  }
  // 週 1 件では必要件数がたまらないので、上限の 28 日で「確度が低い」比較になる
  assert.equal(weekly.day, 28);
  assert.equal(weekly.r.comparison!.lowConfidence, true);
  // 件数不足のまま比べた停滞は、停滞に数えない（温度も上げない）
  if (weekly.r.phase.trend === "flat") assert.equal(weekly.r.tuning.stagnation, 0);
  // 間隔の目安も投稿ペースで変わる（改善処理の間隔にも使う）
  assert.ok(high.r.phase.params.intervalDays[0] < twice.r.phase.params.intervalDays[0]);
  assert.ok(daily.r.phase.clock.postsPerDay > 0.9 && daily.r.phase.clock.postsPerDay < 1.1);
});

test("自動調整: 伸びれば探索を減らし、停滞が続けば・下がれば探索を増やす。基準値は自分の「ふつう」に追従", () => {
  const T0 = new Date("2026-09-01T00:00:00Z").getTime();
  // 1 日 5 件。T0+5 日以降の投稿は表示回数 2 倍、T0+20 日以降は元に戻る（下降）
  const views = (at: number) => (at >= T0 + 5 * DAY && at < T0 + 20 * DAY ? 600 : 300);
  let st = { tuning: INITIAL_TUNING, arms: {} as Record<string, { a: number; b: number }> };
  const trends: string[] = [];
  const temps: number[] = [];
  for (let d = 0; d <= 40; d++) {
    const now = new Date(T0 + d * DAY);
    const r = evaluateGrowth(series(now, 5, views), st, now);
    if (d === 0) assert.equal(r.phase.trend, "new");
    if (r.compared) {
      trends.push(r.phase.trend);
      temps.push(r.tuning.temperature);
    }
    st = { tuning: r.tuning, arms: r.arms };
  }
  assert.ok(trends.includes("up"), trends.join(","));
  assert.ok(trends.includes("down"), trends.join(","));
  const up = trends.indexOf("up");
  assert.ok(temps[up] < (up > 0 ? temps[up - 1] : 1), "伸びたら温度が下がる");
  const down = trends.indexOf("down", up + 1);
  // 下がったら、1 に戻す分を差し引いても温度が上がる
  assert.ok(down > up && temps[down] > 1 + (temps[down - 1] - 1) * 0.85, "下がったら温度が上がる");
  assert.ok(st.tuning.sigma !== null && st.tuning.sigma > 0); // ばらつきを学習
});

test("温度: 停滞が続くと上がるが、上限に張り付かず落ち着く", () => {
  const T0 = new Date("2026-09-01T00:00:00Z").getTime();
  let st = { tuning: INITIAL_TUNING, arms: {} as Record<string, { a: number; b: number }> };
  const temps: number[] = [];
  // 1 日 10 件で 90 日間ずっと同じ水準
  for (let d = 0; d <= 90; d++) {
    const now = new Date(T0 + d * DAY);
    const r = evaluateGrowth(series(now, 10, () => 300), st, now);
    if (r.compared) temps.push(r.tuning.temperature);
    st = { tuning: r.tuning, arms: r.arms };
  }
  assert.ok(temps.length >= 20);
  assert.ok(Math.max(...temps) > 1.2, temps.join(","));
  assert.ok(Math.max(...temps.slice(-10)) < 2, temps.join(","));
  assert.ok(loopParams("x", 2, st.tuning).exploration <= 0.6);
});

test("Jev のポリシー: shadow は反映しない。gate は外れ値・逆向き・様子見を連続 1 回まで保留し、変化なし・間隔の速さを反映", () => {
  const g = (assessment: GrowthReview["assessment"], pace: GrowthReview["pace"] = "keep"): GrowthReview => ({ assessment, pace, mode: "gate" });
  assert.deepEqual(reviewPolicy("up", null, 0), { trend: "up", paceMul: 1, applied: false, reason: "" });
  assert.equal(reviewPolicy("up", { ...g("anomaly"), mode: "shadow" }, 0).trend, "up");
  assert.equal(reviewPolicy("up", g("anomaly"), 0).trend, "hold");
  assert.equal(reviewPolicy("up", g("anomaly"), 1).trend, "up"); // 様子見は連続 1 回まで
  assert.equal(reviewPolicy("up", g("real_decline"), 0).trend, "hold"); // 数値と逆向き
  assert.equal(reviewPolicy("down", g("real_decline"), 0).trend, "down");
  assert.equal(reviewPolicy("flat", g("real_growth", "hold"), 0).trend, "hold");
  assert.equal(reviewPolicy("up", g("noise"), 0).trend, "flat");
  assert.equal(reviewPolicy("up", g("real_growth", "faster"), 0).paceMul, 0.75);
  assert.equal(reviewPolicy("flat", g("noise", "slower"), 0).paceMul, 1.4);
});

test("Jev（gate）の様子見: 基準点を動かさず、次のまとまりも足して比べ直す。速める判定で必要件数が減る", () => {
  const T0 = new Date("2026-09-01T00:00:00Z").getTime();
  const views = () => 300;
  let st = { tuning: INITIAL_TUNING, arms: {} as Record<string, { a: number; b: number }> };
  let held: ReturnType<typeof evaluateGrowth> | null = null;
  for (let d = 0; d <= 10 && !held; d++) {
    const now = new Date(T0 + d * DAY);
    const r = evaluateGrowth(series(now, 10, views), st, now, { assessment: "anomaly", pace: "keep", mode: "gate" });
    if (r.compared) held = r;
    st = { tuning: r.tuning, arms: r.arms };
  }
  assert.ok(held);
  assert.equal(held!.phase.trend, "hold");
  assert.equal(held!.tuning.ref!.holds, 1);
  assert.equal(held!.tuning.review!.applied, true);
  assert.ok(held!.changes.some((c) => c.includes("比較を見送り")));
  // 次の評価: もう一度外れ値と言われても、2 回目は比べる。速める判定で必要件数が減る
  const now = new Date(T0 + 4 * DAY);
  const r2 = evaluateGrowth(series(now, 10, views), st, now, { assessment: "anomaly", pace: "faster", mode: "gate" });
  assert.equal(r2.compared, true);
  assert.notEqual(r2.phase.trend, "hold");
  assert.equal(r2.tuning.ref!.holds, 0);
  const r3 = evaluateGrowth(series(now, 10, views), { tuning: { ...st.tuning, ref: { ...st.tuning.ref!, holds: 0 } }, arms: st.arms }, now, { assessment: "noise", pace: "faster", mode: "gate" });
  assert.equal(r3.phase.trend, "flat");
  assert.equal(r3.tuning.paceFactor, 0.75);
  assert.ok(requiredPosts({ sigma: 0.45, paceFactor: r3.tuning.paceFactor }) < requiredPosts({ sigma: 0.45, paceFactor: 1 }));
});

test("変更の適用後: 変更後の投稿が必要件数たまるまで比べない（変更前の投稿と混ぜない）", () => {
  const T0 = new Date("2026-09-01T00:00:00Z").getTime();
  const views = () => 300;
  let st = { tuning: INITIAL_TUNING, arms: {} as Record<string, { a: number; b: number }> };
  for (let d = 0; d <= 2; d++) {
    const now = new Date(T0 + d * DAY);
    const r = evaluateGrowth(series(now, 2, views), st, now);
    st = { tuning: r.tuning, arms: r.arms };
  }
  // T0+2 日にトピックを変更
  st = { ...st, tuning: { ...st.tuning, changeAt: new Date(T0 + 2 * DAY).toISOString() } };
  let first: { day: number; r: ReturnType<typeof evaluateGrowth> } | null = null;
  for (let d = 3; d <= 30 && !first; d++) {
    const now = new Date(T0 + d * DAY);
    const r = evaluateGrowth(series(now, 2, views), st, now);
    if (d === 3) assert.equal(r.phase.clock.observingChange, true);
    if (r.compared) first = { day: d, r };
    st = { tuning: r.tuning, arms: r.arms };
  }
  // 変更から「出そろう 2 日 + 1 日」以上、かつ変更後の投稿が必要件数たまってから
  assert.ok(first && first.day >= 2 + 3, `${first?.day}`);
  assert.ok(first!.r.comparison!.afterChange);
  assert.ok(first!.r.comparison!.current.posts >= first!.r.comparison!.requiredPosts);
});

test("ノイズの幅: まとまりの件数が多いほど狭い", () => {
  assert.ok(batchTolerance(0.45, 5, 5) > batchTolerance(0.45, 30, 30));
  assert.equal(batchTolerance(0.01, 100, 100), 0.05); // 下限
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
const TOUCHED = ["anthropic_api_key", "jev_api_key", "jev_mode"];
let saved: { key: string; value: string; secret: boolean }[] = [];

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  delete process.env.TYPESAFE_API_KEY;
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

test("DB: 比べるときだけ Jev が判定する。gate の外れ値は様子見、shadow は記録だけ。ルールのトピック変更で変更後の観測を始める", opts, async () => {
  const now = new Date();
  const acc = await svc.saveConnectedAccount(avatarId, "x", { accountId: `gx${Date.now()}`, accountName: "@gx", credentials: { accessToken: "AT", expiresAt: new Date(Date.now() + 86400_000).toISOString() } });
  // 1 日 2 件・40 日分
  for (let i = 0; i < 80; i++) {
    const at = new Date(now.getTime() - i * DAY / 2);
    const v = Math.round(300 * 2 ** (0.4 * gauss(i)));
    await prisma.content.create({
      data: { avatarId, platform: "x", snsAccountId: acc.id, content: `x${i}`, status: "PUBLISHED", category: "automation", publishedAt: at, metadata: { title: i % 2 ? "A" : "B" }, engagement: { views: v, engagements: Math.round(v * 0.03), reposts: 1, fetchedAt: now.toISOString() } },
    });
  }
  let jevCalls = 0;
  let assessment = "anomaly";
  const m = mockFetch([
    [
      "POST",
      /api\.typesafe\.ai\/v1\/systemone/,
      () => {
        jevCalls++;
        return {
          json: {
            model: "jev-test",
            answers: {
              assessment: { type: "choice", choice: assessment, confidence: 0.8, probabilities: { [assessment]: 0.8 } },
              pace: { type: "choice", choice: "keep", confidence: 0.7, probabilities: { keep: 0.7 } },
            },
            usage: { input_tokens: 10, output_tokens: 2 },
          },
        };
      },
    ],
  ]);
  try {
    await svc.setSetting("jev_api_key", "jk-test");
    await svc.setSetting("jev_mode", "gate");
    // 初回（基準点を作るだけ）→ Jev は呼ばない
    await svc.evaluateAccountGrowth(acc.id, new Date(now.getTime() - 12 * DAY));
    assert.equal(jevCalls, 0);
    // 必要件数が出そろった後 → 比べる → Jev（gate）の外れ値で様子見
    const r = await svc.evaluateAccountGrowth(acc.id, now);
    assert.equal(r.compared, true);
    assert.equal(jevCalls, 1);
    assert.equal(r.phase.trend, "hold");
    const ev = await prisma.decisionEvent.findFirstOrThrow({ where: { decisionType: "growth", subjectId: acc.id }, orderBy: { createdAt: "desc" } });
    assert.equal(ev.selectedAction, "anomaly/keep");
    assert.equal(ev.applied, true);
    // 毎日の評価でも、比べないときは Jev を呼ばない
    const g = await svc.growthOf(acc.id);
    assert.equal(g!.tuning.ref!.holds, 1);

    // shadow: 判定は記録するが反映しない
    await svc.setSetting("jev_mode", "shadow");
    const r2 = await svc.evaluateAccountGrowth(acc.id, new Date(now.getTime() + 60_000));
    assert.equal(r2.compared, true);
    assert.equal(jevCalls, 2);
    assert.notEqual(r2.phase.trend, "hold");
    assert.equal(r2.tuning.review!.mode, "shadow");
    assert.equal(r2.tuning.review!.applied, false);
    const r3 = await svc.evaluateAccountGrowth(acc.id, new Date(now.getTime() + 120_000));
    assert.equal(r3.compared, false);
    assert.equal(jevCalls, 2);
  } finally {
    m.restore();
  }

  // ルールのトピックを変える → 変更後の観測
  const rule = await svc.createRule({ avatarId, name: "成長観測", isActive: false, trigger: { type: "interval", hours: 24 }, action: { accountIds: [acc.id], topics: ["A", "B"], mode: "draft" } });
  await svc.updateRule(rule.id, { name: "名前だけ" });
  assert.equal((await svc.growthOf(acc.id))!.tuning.changeAt, null);
  await svc.updateRule(rule.id, { action: { accountIds: [acc.id], topics: ["A", "C"], mode: "draft" } });
  const changed = (await svc.growthOf(acc.id))!.tuning.changeAt;
  assert.ok(changed && Date.now() - new Date(changed).getTime() < 60_000);
  const after = await svc.evaluateAccountGrowth(acc.id, new Date(Date.now() + 60_000));
  assert.equal(after.phase.clock.observingChange, true);
  assert.equal(after.compared, false);
});
