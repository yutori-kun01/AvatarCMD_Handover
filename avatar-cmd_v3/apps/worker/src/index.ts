// ================================================
// Avatar CMD Worker — 予約投稿を処理する常駐プロセス
// ================================================
// SCHEDULER_TICK_MS ごとに期限の来た ScheduledPost を取り出し、各SNSへ投稿する。
// あわせて自動化ルールの実行と、投稿の反応（指標）の定期取得を行う。
// 「今すぐ投稿」もキュー経由（scheduledAt=現在時刻）で処理される。
// note 記事の生成ジョブ（執筆・画像・見出し画像）は別の短い間隔で取り出し、投稿の処理を止めないよう並行で実行する。

import { prisma } from "@avatar-cmd/db";
import { collectFollowers, collectMetrics, ensureDefaultAvatar, processImprovementSchedules, processPerformanceReviews, processYoutubeChannels, processRssFeeds, processQuoteScans, processDuePosts, processDueRules, processArticleJobs, pruneArticleJobs, setSetting, SETTING_KEYS } from "@avatar-cmd/integrations/server";

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS || 15_000);
const MAX_RETRIES = Number(process.env.SCHEDULER_MAX_RETRIES || 3);

// 投稿の反応（指標）の取得は数分おきで十分（各投稿の取得間隔は metricsDue で管理）
const METRICS_EVERY_MS = 10 * 60_000;
let lastMetricsAt = 0;

// note 記事の生成ジョブは画面で待っている人がいるので短い間隔で見る
const ARTICLE_JOBS_EVERY_MS = Number(process.env.ARTICLE_JOBS_TICK_MS || 3_000);

let stopping = false;
let timer: NodeJS.Timeout | undefined;
let jobsTimer: NodeJS.Timeout | undefined;

async function articleJobsTick() {
  try {
    const n = await processArticleJobs();
    if (n) console.log(`[worker] ${new Date().toISOString()} started ${n} article job(s)`);
  } catch (e) {
    console.error("[worker] article jobs failed:", e);
  }
  if (!stopping) jobsTimer = setTimeout(articleJobsTick, ARTICLE_JOBS_EVERY_MS);
}

async function tick() {
  try {
    // ダッシュボードの「worker 稼働中」表示用
    await setSetting(SETTING_KEYS.workerHeartbeat, new Date().toISOString());
    const r = await processDueRules();
    if (r) console.log(`[worker] ${new Date().toISOString()} ran ${r} automation rule(s)`);
    const n = await processDuePosts({ limit: 10, maxRetries: MAX_RETRIES });
    if (n) console.log(`[worker] ${new Date().toISOString()} processed ${n} post(s)`);
    if (Date.now() - lastMetricsAt >= METRICS_EVERY_MS) {
      lastMetricsAt = Date.now();
      const m = await collectMetrics().catch((e) => (console.error("[worker] metrics failed:", e), 0));
      if (m) console.log(`[worker] ${new Date().toISOString()} updated metrics of ${m} post(s)`);
      // フォロワー数（各アカウント1日1回。アカウント分析の推移グラフ用）
      const f = await collectFollowers().catch((e) => (console.error("[worker] followers failed:", e), 0));
      if (f) console.log(`[worker] ${new Date().toISOString()} updated followers of ${f} account(s)`);
      // 改善か継続かの判定（各ルール1日1回）
      const p = await processPerformanceReviews().catch((e) => (console.error("[worker] performance review failed:", e), 0));
      if (p) console.log(`[worker] ${new Date().toISOString()} reviewed performance of ${p} rule(s)`);
      // 改善処理（アバターごとに 14〜27 日のランダム間隔。日程は DB に保存し、完了時にだけ次回を決める）
      const imp = await processImprovementSchedules().catch((e) => (console.error("[worker] improvement failed:", e), 0));
      if (imp) console.log(`[worker] ${new Date().toISOString()} ran improvement for ${imp} avatar(s)`);
      // YouTube チャンネルの新動画の取り込み（取得頻度はチャンネルごと）
      const yt = await processYoutubeChannels().catch((e) => (console.error("[worker] youtube failed:", e), 0));
      if (yt) console.log(`[worker] ${new Date().toISOString()} polled ${yt} YouTube channel(s)`);
      // RSS フィードの新着記事の取り込み（取得頻度はフィードごと）
      const rss = await processRssFeeds().catch((e) => (console.error("[worker] rss failed:", e), 0));
      if (rss) console.log(`[worker] ${new Date().toISOString()} polled ${rss} RSS feed(s)`);
      // 引用候補の自動探索（X アカウントの設定で有効にしたものだけ）
      const q = await processQuoteScans().catch((e) => (console.error("[worker] quote scan failed:", e), 0));
      if (q) console.log(`[worker] ${new Date().toISOString()} scanned quote candidates for ${q} account(s)`);
      await pruneArticleJobs().catch((e) => console.error("[worker] prune article jobs failed:", e));
    }
  } catch (e) {
    console.error("[worker] tick failed:", e);
  }
  if (!stopping) timer = setTimeout(tick, TICK_MS);
}

async function main() {
  if (!process.env.ENCRYPTION_KEY) {
    console.error("[worker] ENCRYPTION_KEY が未設定です（scripts/setup-env.sh で .env を生成してください）");
    process.exit(1);
  }
  await ensureDefaultAvatar();
  console.log(`[worker] started (tick ${TICK_MS}ms, max retries ${MAX_RETRIES})`);
  void articleJobsTick();
  await tick();
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  stopping = true;
  if (timer) clearTimeout(timer);
  if (jobsTimer) clearTimeout(jobsTimer);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
