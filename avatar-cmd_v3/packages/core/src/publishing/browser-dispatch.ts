// ==============================================
// Browser dispatch — hand-off to the Chrome Empire worker
// ==============================================
// Contract (mirrored in packages/chrome-empire/src/worker.ts):
//   queue  : "chrome-empire-tasks"
//   job    : name "run_steps", data BrowserDispatchPayload
//   result : { success, error?, url? }

import { prisma } from "@avatar-cmd/db";
import type { BrowserOperation } from "@avatar-cmd/integrations";

export const CHROME_QUEUE = "chrome-empire-tasks";

export interface BrowserDispatchPayload {
  avatarId: string;
  contentId?: string;
  platform: string;
  steps: BrowserOperation[];
}

interface BrowserResult {
  success: boolean;
  error?: string;
  url?: string;
}

type BullQueue = import("bullmq").Queue;
const g = globalThis as unknown as { __chromeQueue?: BullQueue; __chromeEvents?: boolean };

async function getQueue(): Promise<BullQueue | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!g.__chromeQueue) {
    const [{ Queue }, { default: IORedis }] = await Promise.all([import("bullmq"), import("ioredis")]);
    g.__chromeQueue = new Queue(CHROME_QUEUE, {
      connection: new IORedis(url, { maxRetriesPerRequest: null }),
      defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 200, removeOnFail: 200 },
    });
  }
  return g.__chromeQueue;
}

export async function dispatchBrowserTask(payload: BrowserDispatchPayload): Promise<boolean> {
  const q = await getQueue();
  if (!q) return false;
  await q.add("run_steps", payload);
  return true;
}

async function finalize(contentId: string, result: BrowserResult) {
  const content = await prisma.content.findUnique({ where: { id: contentId }, include: { scheduledPost: true } });
  if (!content || content.status !== "PUBLISHING") return;
  const ok = result.success;
  await prisma.content.update({
    where: { id: contentId },
    data: {
      status: ok ? "PUBLISHED" : "FAILED",
      publishedAt: ok ? new Date() : null,
      postUrl: result.url ?? null,
      metadata: { ...((content.metadata as Record<string, unknown>) ?? {}), publishMode: "browser", ...(result.error ? { lastError: result.error } : {}) },
    },
  });
  if (content.scheduledPost) {
    await prisma.scheduledPost.update({
      where: { id: content.scheduledPost.id },
      data: { status: ok ? "published" : "failed", lastError: result.error ?? null, publishedAt: ok ? new Date() : null },
    });
  }
  await prisma.activityLog.create({
    data: {
      avatarId: content.avatarId,
      action: ok ? "post_published" : "post_failed",
      category: "sns",
      level: ok ? "success" : "error",
      description: ok ? `${content.platform} にブラウザ経由で投稿しました` : `${content.platform} のブラウザ投稿に失敗: ${result.error}`,
      metadata: { contentId, mode: "browser" },
    },
  });
}

/** Listen for Chrome Empire results and finalize content status. */
export async function startBrowserResultListener(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url || g.__chromeEvents) return;
  g.__chromeEvents = true;
  const [{ QueueEvents, Job }, { default: IORedis }] = await Promise.all([import("bullmq"), import("ioredis")]);
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  const events = new QueueEvents(CHROME_QUEUE, { connection });
  const q = await getQueue();

  const handle = async (jobId: string, result: BrowserResult) => {
    if (!q) return;
    const job = await Job.fromId(q, jobId);
    const contentId = (job?.data as BrowserDispatchPayload | undefined)?.contentId;
    if (contentId) await finalize(contentId, result).catch((e) => console.error("[BrowserDispatch] finalize failed", e));
  };
  events.on("completed", ({ jobId, returnvalue }) => {
    const rv = (typeof returnvalue === "string" ? JSON.parse(returnvalue) : returnvalue) as BrowserResult;
    void handle(jobId, rv ?? { success: false, error: "no result" });
  });
  events.on("failed", ({ jobId, failedReason }) => void handle(jobId, { success: false, error: failedReason }));
}

export async function getChromeQueueCounts(): Promise<Record<string, number> | null> {
  const q = await getQueue();
  if (!q) return null;
  return q.getJobCounts("waiting", "active", "completed", "failed", "delayed");
}

/** Pool status snapshot published by the Chrome Empire worker (Redis key). */
export const CHROME_STATUS_KEY = "chrome-empire:status";

export async function getChromePoolStatus(): Promise<{ online: boolean; updatedAt?: string; status?: unknown }> {
  const url = process.env.REDIS_URL;
  if (!url) return { online: false };
  const { default: IORedis } = await import("ioredis");
  const client = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 2000 });
  try {
    await client.connect();
    const raw = await client.get(CHROME_STATUS_KEY);
    if (!raw) return { online: false };
    const parsed = JSON.parse(raw) as { updatedAt: string; status: unknown };
    const fresh = Date.now() - new Date(parsed.updatedAt).getTime() < 90_000;
    return { online: fresh, updatedAt: parsed.updatedAt, status: parsed.status };
  } catch {
    return { online: false };
  } finally {
    client.disconnect();
  }
}
