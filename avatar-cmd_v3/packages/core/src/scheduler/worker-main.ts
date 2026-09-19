// ================================================
// worker サービスのエントリポイント
// ================================================
// Redis のアプリジョブキューを消費する常駐プロセス。
// web はジョブを投入するだけで処理しないため、web の再起動や
// レプリカ数に影響されずにジョブが処理される。

import { createServer } from "http";
import { closeQueues, createAppWorker, type AppJobPayload, type AppJobType } from "@avatar-cmd/queue";
import { processJob } from "./workers";

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
