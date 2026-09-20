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

import IORedis from "ioredis";
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
  // chrome-empire からブラウザ投稿の結果を受け取る。
  // chrome-empire は DB を持たないため、Content の更新は worker が行う。
  | "browser_result"
  | "system_maintenance";

export interface AppJobPayload {
  userId?: string;
  avatarId?: string;
  automationId?: string;
  data?: Record<string, unknown>;
}

/**
 * 単発のブラウザ操作。chrome-empire の BrowserTask と同じ形。
 * 型を共有するために chrome-empire / integrations へ依存させたくない
 * （Playwright を引き込むため）ので構造だけをこちらに置く。
 */
export interface BrowserTaskJob {
  kind: "task";
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

/**
 * Provider が組み立てた操作列。integrations の BrowserOperation と同じ形。
 * getPostSteps() / getLoginSteps() の戻り値をそのまま渡す。
 */
export interface BrowserOperationStep {
  action:
    | "login"
    | "post"
    | "read"
    | "engage"
    | "collect_metrics"
    | "search"
    | "navigate";
  url: string;
  selectors?: Record<string, string>;
  inputData?: Record<string, string>;
  confirmationUrlPattern?: string;
  waitFor?: string;
  timeout?: number;
}

export interface BrowserOperationsJob {
  kind: "operations";
  avatarId: string;
  /** どのプラットフォーム向けか（ログ用） */
  platform?: string;
  /** 紐づく Content のID。完了時に状態を戻すために使う */
  contentId?: string;
  attemptId?: string;
  operations: BrowserOperationStep[];
}

export type BrowserJobPayload = BrowserTaskJob | BrowserOperationsJob;

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
  payload: AppJobPayload,
  jobId?: string,
): Promise<string> {
  const job = await getAppQueue().add(
    type,
    payload,
    jobId ? { jobId } : undefined,
  );
  return job.id ?? "";
}

/** ブラウザ操作ジョブを投入し、ジョブIDを返す */
export async function enqueueBrowserJob(
  payload: BrowserJobPayload,
): Promise<string> {
  const name = payload.kind === "task" ? payload.type : "operations";
  const job = await getBrowserQueue().add(name, payload, {
    attempts: 1,
    ...(payload.kind === "operations" && payload.attemptId
      ? { jobId: `browser-${payload.attemptId}` }
      : {}),
  });
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
    "delayed",
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
  processor: Processor<AppJobPayload, unknown, AppJobType>,
): Worker<AppJobPayload, unknown, AppJobType> {
  return new Worker(APP_QUEUE_NAME, processor, {
    connection: connectionOptions(),
    concurrency: concurrency("WORKER_CONCURRENCY", 2),
  });
}

export function createBrowserWorker(
  processor: Processor<BrowserJobPayload>,
): Worker<BrowserJobPayload> {
  return new Worker(BROWSER_QUEUE_NAME, processor, {
    connection: connectionOptions(),
    // ブラウザ1つあたりのメモリが大きいので既定は1
    concurrency: concurrency("BROWSER_CONCURRENCY", 1),
  });
}

// ─── 分散ロック ───
// 複数の worker レプリカが同時にスケジューラの tick を回すと
// 同じジョブを二重投入してしまうため、Redis の SET NX で排他する。
let lockRedis: IORedis | null = null;

function getLockRedis(): IORedis {
  if (!lockRedis) lockRedis = new IORedis(redisUrl());
  return lockRedis;
}

/**
 * ロックを取れたら fn を実行する。取れなければ何もせず null を返す。
 * ttlMs はロックの有効期限。プロセスが落ちても自動的に解放される。
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const redis = getLockRedis();
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  const lockKey = `avatar-cmd-lock:${key}`;

  const acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return null;

  try {
    return await fn();
  } finally {
    // 自分が取ったロックだけを解放する（TTL 切れ後の他者のロックを消さない）
    await redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        token,
      )
      .catch(() => undefined);
  }
}

/**
 * 投入側の接続を閉じる（プロセス終了時）。
 * quit() は応答待ちでソケットが残ることがあるため、最後に
 * disconnect() で確実に解放する。
 */
export async function closeQueues(): Promise<void> {
  const lock = lockRedis;
  await Promise.allSettled([
    appQueue?.close(),
    browserQueue?.close(),
    lock?.quit(),
  ]);
  lock?.disconnect();
  appQueue = null;
  browserQueue = null;
  lockRedis = null;
}

export { Queue, Worker };
export type { Job as BullJob } from "bullmq";
