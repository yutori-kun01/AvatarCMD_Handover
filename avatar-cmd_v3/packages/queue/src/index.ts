// ================================================
// @avatar-cmd/queue — Redis (BullMQ) ジョブキュー
// ================================================
// web / worker / chrome-empire の3プロセスが共有する。
// Prisma も Playwright も参照しないため、どのイメージからも読める。
//
// 従来はプロセス内の配列にジョブを積んでいたため、
//   - web を再起動すると未処理ジョブが消える
//   - web を複数レプリカにするとジョブが片方にしか見えない
// という制約があった。Redis に移すことで両方を解消する。

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";

// ─── キュー名 ───
/** AI生成・ナレッジ収集などのアプリジョブ。worker サービスが処理する */
// BullMQ はキュー名に ":" を許可しない（Redis キーの区切りに使うため）
export const APP_QUEUE_NAME = "avatar-cmd-jobs";
/** ブラウザ操作。chrome-empire サービスが処理する */
export const BROWSER_QUEUE_NAME = "avatar-cmd-browser";

// ─── ペイロード ───
export type AppJobType =
  | "generate_post"
  | "publish_post"
  | "fetch_knowledge"
  | "system_maintenance";

export interface AppJobPayload {
  avatarId?: string;
  automationId?: string;
  data?: Record<string, unknown>;
}

/**
 * ブラウザ操作ジョブ。
 * chrome-empire の BrowserTask と同じ形。型を共有するために
 * chrome-empire へ依存させたくない（Playwright を引き込むため）ので
 * 構造だけをこちらに置く。
 */
export interface BrowserJobPayload {
  type:
    | "navigate"
    | "post"
    | "engage"
    | "scrape"
    | "screenshot"
    | "login"
    | "custom";
  avatarId: string;
  url?: string;
  payload?: Record<string, unknown>;
  timeout?: number;
}

// ─── 接続 ───
function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

/**
 * BullMQ の接続設定。
 * maxRetriesPerRequest: null は Worker に必須（BullMQ が待機時に
 * ブロッキングコマンドを使うため、リトライ上限があると切断される）。
 */
export function connectionOptions(): ConnectionOptions {
  const url = new URL(redisUrl());
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

/** 既定のリトライ方針。指数バックオフで3回まで */
const DEFAULT_JOB_OPTIONS = {
  attempts: Number(process.env.SCHEDULER_MAX_RETRIES ?? 3),
  backoff: { type: "exponential" as const, delay: 5_000 },
  // 完了・失敗の履歴を残しすぎない
  removeOnComplete: { count: 200, age: 24 * 60 * 60 },
  removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
};

// ─── Queue（投入側） ───
let appQueue: Queue<AppJobPayload, unknown, AppJobType> | null = null;
let browserQueue: Queue<BrowserJobPayload> | null = null;

export function getAppQueue(): Queue<AppJobPayload, unknown, AppJobType> {
  if (!appQueue) {
    appQueue = new Queue(APP_QUEUE_NAME, {
      connection: connectionOptions(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return appQueue;
}

export function getBrowserQueue(): Queue<BrowserJobPayload> {
  if (!browserQueue) {
    browserQueue = new Queue(BROWSER_QUEUE_NAME, {
      connection: connectionOptions(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return browserQueue;
}

/** アプリジョブを投入し、ジョブIDを返す */
export async function enqueueAppJob(
  type: AppJobType,
  payload: AppJobPayload
): Promise<string> {
  const job = await getAppQueue().add(type, payload);
  return job.id ?? "";
}

/** ブラウザ操作ジョブを投入し、ジョブIDを返す */
export async function enqueueBrowserJob(
  payload: BrowserJobPayload
): Promise<string> {
  const job = await getBrowserQueue().add(payload.type, payload);
  return job.id ?? "";
}

// ─── 状態取得 ───
export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export async function getQueueStats(queue: Queue): Promise<QueueStats> {
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed"
  );
  return {
    name: queue.name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}

// ─── Worker（消費側） ───
function concurrency(envName: string, fallback: number): number {
  const raw = process.env[envName];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function createAppWorker(
  processor: Processor<AppJobPayload, unknown, AppJobType>
): Worker<AppJobPayload, unknown, AppJobType> {
  return new Worker(APP_QUEUE_NAME, processor, {
    connection: connectionOptions(),
    concurrency: concurrency("WORKER_CONCURRENCY", 2),
  });
}

export function createBrowserWorker(
  processor: Processor<BrowserJobPayload>
): Worker<BrowserJobPayload> {
  return new Worker(BROWSER_QUEUE_NAME, processor, {
    connection: connectionOptions(),
    // ブラウザ1つあたりのメモリが大きいので既定は1
    concurrency: concurrency("BROWSER_CONCURRENCY", 1),
  });
}

/** 投入側の接続を閉じる（プロセス終了時） */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled([appQueue?.close(), browserQueue?.close()]);
  appQueue = null;
  browserQueue = null;
}

export { Queue, Worker };
export type { Job as BullJob } from "bullmq";
