// ================================================
// Avatar CMD Worker — 予約投稿を処理する常駐プロセス
// ================================================
// SCHEDULER_TICK_MS ごとに期限の来た ScheduledPost を取り出し、各SNSへ投稿する。
// あわせて自動化ルールの実行と、投稿の反応（指標）の定期取得を行う。
// 「今すぐ投稿」もキュー経由（scheduledAt=現在時刻）で処理される。

import { prisma } from "@avatar-cmd/db";
import { collectMetrics, ensureDefaultAvatar, processPerformanceReviews, processQuoteScans, processDuePosts, processDueRules, setSetting, SETTING_KEYS } from "@avatar-cmd/integrations/server";

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS || 15_000);
const MAX_RETRIES = Number(process.env.SCHEDULER_MAX_RETRIES || 3);

// 投稿の反応（指標）の取得は数分おきで十分（各投稿の取得間隔は metricsDue で管理）
const METRICS_EVERY_MS = 10 * 60_000;
let lastMetricsAt = 0;

let stopping = false;
let timer: NodeJS.Timeout | undefined;

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
      // 改善か継続かの判定（各ルール1日1回）
      const p = await processPerformanceReviews().catch((e) => (console.error("[worker] performance review failed:", e), 0));
      if (p) console.log(`[worker] ${new Date().toISOString()} reviewed performance of ${p} rule(s)`);
      // 引用候補の自動探索（X アカウントの設定で有効にしたものだけ）
      const q = await processQuoteScans().catch((e) => (console.error("[worker] quote scan failed:", e), 0));
      if (q) console.log(`[worker] ${new Date().toISOString()} scanned quote candidates for ${q} account(s)`);
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
  await tick();
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  stopping = true;
  if (timer) clearTimeout(timer);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
