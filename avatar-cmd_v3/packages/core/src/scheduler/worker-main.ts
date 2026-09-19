// ================================================
// worker サービスのエントリポイント
// ================================================
// Redis のアプリジョブキューを消費する常駐プロセス。
// web はジョブを投入するだけで処理しないため、web の再起動や
// レプリカ数に影響されずにジョブが処理される。

import { createServer } from "http";
import { closeQueues, createAppWorker, type AppJobPayload, type AppJobType } from "@avatar-cmd/queue";
import { processJob } from "./workers";
import { runSchedulerTick } from "./tick";

const port = Number(process.env.WORKER_PORT ?? 4100);

const worker = createAppWorker(async (job) => {
  console.log(`[Worker] Processing ${job.id} (${job.name})`);
  await processJob({
    id: job.id ?? "",
    type: job.name as AppJobType,
    payload: (job.data ?? {}) as AppJobPayload,
  });
  console.log(`[Worker] Completed ${job.id} (${job.name})`);
});

worker.on("failed", (job, error) => {
  // attempts を使い切ったかどうかで扱いを分けたいので試行回数も出す
  console.error(
    `[Worker] Job ${job?.id} (${job?.name}) failed on attempt ` +
      `${job?.attemptsMade}/${job?.opts?.attempts ?? 1}:`,
    error?.message ?? error
  );
});

worker.on("error", (error) => {
  console.error("[Worker] Queue error:", error?.message ?? error);
});

// ─── スケジューラ ───
// AutomationRule の cron と期限が来た予約投稿を一定間隔で評価する。
// 複数レプリカでの二重投入は tick 側の Redis ロックで防いでいる。
const tickMs = Number(process.env.SCHEDULER_TICK_MS ?? 30_000);
let tickTimer: NodeJS.Timeout | null = null;
let tickRunning = false;

async function tick(): Promise<void> {
  if (tickRunning) return; // 前回の tick が長引いている場合は飛ばす
  tickRunning = true;
  try {
    const result = await runSchedulerTick();
    if (
      !result.skipped &&
      (result.rulesFired > 0 || result.scheduledPostsFired > 0 || result.stalePublishing > 0)
    ) {
      console.log(
        `[Scheduler] Fired ${result.rulesFired} rule(s), ` +
          `${result.scheduledPostsFired} scheduled post(s), ` +
          `cleaned ${result.stalePublishing} stale publishing`
      );
    }
  } catch (error) {
    console.error("[Scheduler] Tick failed:", error instanceof Error ? error.message : error);
  } finally {
    tickRunning = false;
  }
}

if (process.env.SCHEDULER_ENABLED !== "false") {
  tickTimer = setInterval(() => void tick(), tickMs);
  console.log(`[Scheduler] Tick every ${tickMs}ms`);
} else {
  console.log("[Scheduler] Disabled by SCHEDULER_ENABLED=false");
}

// compose の healthcheck 用。Redis へ接続できているかを返す
const server = createServer((req, res) => {
  if ((req.url ?? "/") === "/health") {
    const ok = worker.isRunning();
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: ok ? "ok" : "stopped",
        uptime: Math.floor(process.uptime()),
      })
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[Worker] Listening on :${port} (/health)`);
  console.log(`[Worker] Consuming app job queue`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Worker] Received ${signal}, shutting down...`);

  server.close();
  if (tickTimer) clearInterval(tickTimer);
  try {
    // 処理中のジョブを終わらせてから閉じる
    await worker.close();
    await closeQueues();
  } catch (error) {
    console.error("[Worker] Shutdown error:", error);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
