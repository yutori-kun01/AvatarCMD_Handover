// ================================================
// @avatar-cmd/chrome-empire — Worker Entrypoint
// ================================================
// chrome-empire コンテナのエントリポイント。
// Playwright プールを常駐させ、状態を HTTP で公開する。
//
// docker-compose の chrome-empire は dist/worker.js を参照していたが
// 実体が存在せず、コンテナが起動できない状態だった。
//
// 注意: ジョブの受け取り（Redis 経由のキュー）は未実装。
// 現状は web プロセス内のインメモリキュー (packages/core/scheduler) が
// ジョブを処理しており、このワーカーはプールの保持と監視のみを行う。

import { createServer } from "http";
import { ChromeEmpire } from "./pool";

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

const server = createServer((req, res) => {
  const url = req.url ?? "/";

  // ヘルスチェックは compose / Cloudflare Tunnel 側から参照する
  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: Math.floor(process.uptime()) }));
    return;
  }

  if (url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(empire.getPoolStatus()));
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
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ChromeWorker] Received ${signal}, shutting down...`);

  server.close();
  try {
    await empire.shutdown();
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
