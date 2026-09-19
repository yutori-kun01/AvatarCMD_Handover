// ================================================
// @avatar-cmd/chrome-empire — Worker Entrypoint
// ================================================
// chrome-empire コンテナのエントリポイント。
// Playwright プールを常駐させ、状態を HTTP で公開する。
//
// docker-compose の chrome-empire は dist/worker.js を参照していたが
// 実体が存在せず、コンテナが起動できない状態だった。
//
// ブラウザ操作ジョブは Redis (BullMQ) のブラウザキューから受け取る。
// ペイロードは2種類:
//   kind: "task"       … 単発操作（navigate / scrape / screenshot 等）
//   kind: "operations" … Provider が組み立てたセレクタ駆動の操作列

import { createServer } from "http";
import {
  closeQueues,
  createBrowserWorker,
  getQueueStats,
  getBrowserQueue,
} from "@avatar-cmd/queue";
import { ChromeEmpire } from "./pool";
import type { BrowserTask } from "./types";
import type { OperationStep } from "./operations";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const port = intFromEnv("CHROME_WORKER_PORT", 4000);

const empire = new ChromeEmpire({
  maxInstances: intFromEnv("CHROME_POOL_SIZE", 3),
  storageBaseDir: process.env.CHROME_STORAGE_DIR ?? "/app/data/profiles",
  headless: process.env.CHROME_HEADLESS !== "false",
  stealthMode: process.env.CHROME_STEALTH !== "false",
});

// ブラウザキューの消費
const queueWorker = createBrowserWorker(async (job) => {
  const data = job.data;
  const label = data.kind === "task" ? data.type : `operations(${data.operations.length})`;
  console.log(`[ChromeWorker] Executing ${job.id} (${label}) for ${data.avatarId}`);

  // executeTask / executeOperationsForAvatar は既存インスタンスを前提に
  // するため、無ければ先に起動する。プール上限のチェックは
  // spawnForAvatar 側で行われ、上限超過時は例外になって
  // BullMQ のリトライに乗る（空きが出てから再試行される）。
  if (!empire.getInstance(data.avatarId)) {
    console.log(`[ChromeWorker] Spawning instance for ${data.avatarId}`);
    await empire.spawnForAvatar(data.avatarId);
  }

  if (data.kind === "operations") {
    const result = await empire.executeOperationsForAvatar(
      data.avatarId,
      data.operations as OperationStep[]
    );
    if (!result.success) {
      // 失敗を投げて BullMQ のリトライに乗せる
      throw new Error(result.error ?? "Browser operations failed");
    }
    return result;
  }

  const task: BrowserTask = {
    type: data.type,
    avatarId: data.avatarId,
    url: data.url,
    payload: data.payload,
    timeout: data.timeout,
  };
  const result = await empire.executeTask(task);
  if (!result.success) {
    throw new Error(result.error ?? `Browser task ${task.type} failed`);
  }
  return result;
});

queueWorker.on("failed", (job, error) => {
  console.error(
    `[ChromeWorker] Job ${job?.id} (${job?.name}) failed on attempt ` +
      `${job?.attemptsMade}/${job?.opts?.attempts ?? 1}:`,
    error?.message ?? error
  );
});

queueWorker.on("error", (error) => {
  console.error("[ChromeWorker] Queue error:", error?.message ?? error);
});

const server = createServer((req, res) => {
  const url = req.url ?? "/";

  // ヘルスチェックは compose 側から参照する
  if (url === "/health") {
    const ok = queueWorker.isRunning();
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: ok ? "ok" : "stopped",
        uptime: Math.floor(process.uptime()),
      })
    );
    return;
  }

  if (url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    void getQueueStats(getBrowserQueue())
      .then((queue) =>
        res.end(JSON.stringify({ pool: empire.getPoolStatus(), queue }))
      )
      .catch(() =>
        res.end(JSON.stringify({ pool: empire.getPoolStatus(), queue: null }))
      );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

async function main(): Promise<void> {
  await empire.start();

  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", resolve);
  });
  console.log(`[ChromeWorker] Listening on :${port} (/health, /status)`);
  console.log(`[ChromeWorker] Consuming browser job queue`);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ChromeWorker] Received ${signal}, shutting down...`);

  server.close();
  try {
    // 処理中のタスクを終わらせてからブラウザを閉じる
    await queueWorker.close();
    await empire.shutdown();
    await closeQueues();
  } catch (error) {
    console.error("[ChromeWorker] Shutdown error:", error);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((error) => {
  console.error("[ChromeWorker] Fatal:", error);
  process.exit(1);
});
