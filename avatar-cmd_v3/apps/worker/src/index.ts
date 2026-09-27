// ================================================
// Avatar CMD Worker — 予約投稿を処理する常駐プロセス
// ================================================
// SCHEDULER_TICK_MS ごとに期限の来た ScheduledPost を取り出し、各SNSへ投稿する。
// 「今すぐ投稿」もキュー経由（scheduledAt=現在時刻）で処理される。

import { prisma } from "@avatar-cmd/db";
import { ensureDefaultAvatar, processDuePosts, processDueRules, setSetting, SETTING_KEYS } from "@avatar-cmd/integrations/server";

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS || 15_000);
const MAX_RETRIES = Number(process.env.SCHEDULER_MAX_RETRIES || 3);

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
