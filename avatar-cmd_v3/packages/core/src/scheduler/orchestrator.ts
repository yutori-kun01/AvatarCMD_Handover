// ==============================================
// Orchestrator — job queue with pluggable backend
// ==============================================
// • REDIS_URL set  → BullMQ (persistent, retries w/ exponential backoff,
//                     safe across multiple web/worker processes)
// • otherwise      → in-process memory queue (dev / single instance)
//
// The singleton lives on globalThis so Next.js HMR does not spawn
// duplicate queues/workers.

import { randomUUID } from "crypto";
import type { Queue as BullQueue, Worker as BullWorker } from "bullmq";
import type IORedis from "ioredis";

export type JobType =
  | "generate_post"
  | "publish_post"
  | "publish_due"
  | "fetch_knowledge"
  | "system_maintenance";

export const JOB_TYPES: JobType[] = ["generate_post", "publish_post", "publish_due", "fetch_knowledge", "system_maintenance"];

export interface JobPayload {
  avatarId?: string;
  automationId?: string;
  contentId?: string;
  data?: Record<string, unknown>;
}

export interface Job {
  id: string;
  type: JobType;
  payload: JobPayload;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  error?: string;
  createdAt: Date;
  finishedAt?: Date;
}

export interface QueueStatus {
  backend: "redis" | "memory";
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  jobs: Pick<Job, "id" | "type" | "status" | "attempts" | "error" | "createdAt" | "finishedAt">[];
}

export type JobProcessor = (job: Job) => Promise<void>;

interface QueueBackend {
  readonly kind: "redis" | "memory";
  add(type: JobType, payload: JobPayload): Promise<string>;
  startWorker(processor: JobProcessor): void;
  status(): Promise<QueueStatus>;
  close(): Promise<void>;
}

const QUEUE_NAME = "avatar-cmd-jobs";
const MAX_ATTEMPTS = Number(process.env.SCHEDULER_MAX_RETRIES || 3);

export function isValidJobType(t: unknown): t is JobType {
  return typeof t === "string" && (JOB_TYPES as string[]).includes(t);
}

// ─── Memory backend ───────────────────────────────

class MemoryBackend implements QueueBackend {
  readonly kind = "memory" as const;
  private jobs: Job[] = [];
  private processor: JobProcessor | null = null;
  private running = false;

  async add(type: JobType, payload: JobPayload): Promise<string> {
    const job: Job = { id: randomUUID(), type, payload, status: "pending", attempts: 0, createdAt: new Date() };
    this.jobs.push(job);
    this.drain();
    return job.id;
  }

  startWorker(processor: JobProcessor): void {
    this.processor = processor;
    this.drain();
  }

  private drain(): void {
    if (this.running || !this.processor) return;
    this.running = true;
    void (async () => {
      try {
        let job: Job | undefined;
        while ((job = this.jobs.find((j) => j.status === "pending"))) {
          job.status = "processing";
          job.attempts++;
          try {
            await this.processor!(job);
            job.status = "completed";
          } catch (e) {
            job.error = e instanceof Error ? e.message : String(e);
            job.status = job.attempts < MAX_ATTEMPTS ? "pending" : "failed";
            if (job.status === "pending") await new Promise((r) => setTimeout(r, 500 * 2 ** job!.attempts));
          }
          if (job.status !== "pending") job.finishedAt = new Date();
        }
        // keep history bounded
        const done = this.jobs.filter((j) => j.status === "completed" || j.status === "failed");
        if (done.length > 200) {
          const drop = new Set(done.slice(0, done.length - 200).map((j) => j.id));
          this.jobs = this.jobs.filter((j) => !drop.has(j.id));
        }
      } finally {
        this.running = false;
      }
    })();
  }

  async status(): Promise<QueueStatus> {
    const count = (s: Job["status"]) => this.jobs.filter((j) => j.status === s).length;
    return {
      backend: "memory",
      pending: count("pending"),
      processing: count("processing"),
      completed: count("completed"),
      failed: count("failed"),
      jobs: this.jobs.slice(-50).reverse().map(({ payload: _p, ...rest }) => rest),
    };
  }

  async close(): Promise<void> {
    this.processor = null;
  }
}

// ─── Redis (BullMQ) backend ───────────────────────

class RedisBackend implements QueueBackend {
  readonly kind = "redis" as const;
  private queue: BullQueue;
  private worker: BullWorker | null = null;
  private connection: IORedis;

  constructor(
    private readonly bull: typeof import("bullmq"),
    IORedisCtor: typeof import("ioredis").default,
    url: string
  ) {
    this.connection = new IORedisCtor(url, { maxRetriesPerRequest: null });
    this.queue = new bull.Queue(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });
  }

  async add(type: JobType, payload: JobPayload): Promise<string> {
    const job = await this.queue.add(type, payload);
    return String(job.id);
  }

  startWorker(processor: JobProcessor): void {
    if (this.worker) return;
    this.worker = new this.bull.Worker(
      QUEUE_NAME,
      async (bj) => {
        await processor({
          id: String(bj.id),
          type: bj.name as JobType,
          payload: bj.data as JobPayload,
          status: "processing",
          attempts: bj.attemptsMade + 1,
          createdAt: new Date(bj.timestamp),
        });
      },
      { connection: this.connection.duplicate(), concurrency: Number(process.env.QUEUE_CONCURRENCY || 2) }
    );
    this.worker.on("failed", (job, err) => console.error(`[Orchestrator] job ${job?.id} (${job?.name}) failed: ${err.message}`));
  }

  async status(): Promise<QueueStatus> {
    const counts = await this.queue.getJobCounts("waiting", "delayed", "active", "completed", "failed");
    const jobs = await this.queue.getJobs(["waiting", "delayed", "active", "completed", "failed"], 0, 49, false);
    const states = await Promise.all(jobs.map((j) => j.getState()));
    return {
      backend: "redis",
      pending: (counts.waiting ?? 0) + (counts.delayed ?? 0),
      processing: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      jobs: jobs.map((j, i) => ({
        id: String(j.id),
        type: j.name as JobType,
        status: (states[i] === "active" ? "processing" : states[i] === "completed" ? "completed" : states[i] === "failed" ? "failed" : "pending") as Job["status"],
        attempts: j.attemptsMade,
        error: j.failedReason,
        createdAt: new Date(j.timestamp),
        finishedAt: j.finishedOn ? new Date(j.finishedOn) : undefined,
      })),
    };
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}

// ─── Orchestrator facade ──────────────────────────

class Orchestrator {
  private backendPromise: Promise<QueueBackend> | null = null;

  private backend(): Promise<QueueBackend> {
    if (!this.backendPromise) {
      this.backendPromise = (async () => {
        const url = process.env.REDIS_URL;
        if (url && process.env.QUEUE_BACKEND !== "memory") {
          try {
            const [bull, ioredis] = await Promise.all([import("bullmq"), import("ioredis")]);
            const backend = new RedisBackend(bull, ioredis.default, url);
            console.log("[Orchestrator] Using Redis (BullMQ) backend");
            return backend;
          } catch (e) {
            console.warn("[Orchestrator] Redis backend unavailable, falling back to memory:", e);
          }
        }
        console.log("[Orchestrator] Using in-memory backend");
        return new MemoryBackend();
      })();
    }
    return this.backendPromise;
  }

  async addJob(type: JobType, payload: JobPayload): Promise<string> {
    if (!isValidJobType(type)) throw new Error(`Unknown job type: ${type}`);
    const id = await (await this.backend()).add(type, payload);
    console.log(`[Orchestrator] Enqueued job ${id} (${type})`);
    return id;
  }

  async startWorker(processor?: JobProcessor): Promise<void> {
    const proc = processor ?? (await import("./workers")).processJob;
    (await this.backend()).startWorker(proc);
  }

  async getQueueStatus(): Promise<QueueStatus> {
    return (await this.backend()).status();
  }

  async close(): Promise<void> {
    if (this.backendPromise) await (await this.backendPromise).close();
    this.backendPromise = null;
  }
}

const g = globalThis as unknown as { __avatarCmdOrchestrator?: Orchestrator };
export const orchestrator: Orchestrator = g.__avatarCmdOrchestrator ?? (g.__avatarCmdOrchestrator = new Orchestrator());
