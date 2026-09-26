// ================================================
// @avatar-cmd/chrome-empire — Worker process
// ================================================
// Consumes browser tasks dispatched by @avatar-cmd/core (publisher) over
// Redis/BullMQ and runs them in the Playwright pool. Publishes a pool status
// heartbeat to Redis so the dashboard (/api/chrome-pool) can display it.
//
// Contract (mirrored in packages/core/src/publishing/browser-dispatch.ts):
//   queue "chrome-empire-tasks", job "run_steps",
//   data { avatarId, contentId?, platform, steps: BrowserStep[] }
//   return { success, error?, url? }

import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { ChromeEmpire } from "./pool";
import type { BrowserStep } from "./types";

const QUEUE = "chrome-empire-tasks";
const STATUS_KEY = "chrome-empire:status";
const REDIS_URL = process.env.REDIS_URL;

interface Payload {
  avatarId: string;
  contentId?: string;
  platform: string;
  steps: BrowserStep[];
}

if (!REDIS_URL) {
  console.error("[ChromeWorker] REDIS_URL is required");
  process.exit(1);
}

const maxInstances = Number(process.env.CHROME_POOL_SIZE || 3);
const pool = new ChromeEmpire({
  maxInstances,
  headless: process.env.CHROME_HEADLESS !== "false",
  stealthMode: process.env.CHROME_STEALTH !== "false",
  storageBaseDir: process.env.CHROME_DATA_DIR || "./data/chrome",
});

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const statusClient = connection.duplicate();

async function publishStatus() {
  const status = { ...pool.getPoolStatus(), maxInstances };
  await statusClient.set(STATUS_KEY, JSON.stringify({ updatedAt: new Date().toISOString(), status }), "EX", 120);
}

async function main() {
  await pool.start();
  pool.on((e) => console.log(`[ChromeWorker] ${e.type}`, "avatarId" in e ? e.avatarId : ""));

  const worker = new Worker<Payload>(
    QUEUE,
    async (job: Job<Payload>) => {
      const { avatarId, steps, platform } = job.data;
      if (!avatarId || !Array.isArray(steps) || steps.length === 0) throw new Error("Invalid task payload");
      console.log(`[ChromeWorker] Job ${job.id}: ${platform} (${steps.length} steps) for ${avatarId}`);
      const result = await pool.executeSteps(avatarId, steps);
      await publishStatus().catch(() => {});
      const url = (result.data as { url?: string } | undefined)?.url;
      return { success: result.success, error: result.error, url };
    },
    { connection: connection.duplicate(), concurrency: maxInstances }
  );
  worker.on("failed", (job, err) => console.error(`[ChromeWorker] Job ${job?.id} failed: ${err.message}`));

  await publishStatus();
  const heartbeat = setInterval(() => publishStatus().catch((e) => console.error("[ChromeWorker] status publish failed", e)), 30_000);
  console.log(`[ChromeWorker] Ready. Queue "${QUEUE}", pool size ${maxInstances}`);

  const shutdown = async (signal: string) => {
    console.log(`[ChromeWorker] ${signal} received, shutting down...`);
    clearInterval(heartbeat);
    await worker.close();
    await pool.shutdown();
    await statusClient.del(STATUS_KEY).catch(() => {});
    statusClient.disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[ChromeWorker] Fatal:", e);
  process.exit(1);
});
