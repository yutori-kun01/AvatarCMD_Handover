// ================================================
// @avatar-cmd/core — Scheduler Service / Worker
// ================================================
// Cron-like scheduler for content publishing and
// automated tasks. Runs as a background loop.

export type ScheduleFrequency = "once" | "hourly" | "daily" | "weekly" | "cron";

export interface ScheduledJob {
  id: string;
  name: string;
  avatarId: string;
  type: "post" | "collect_metrics" | "run_improvement" | "scrape" | "custom";
  frequency: ScheduleFrequency;
  cronExpr?: string; // For cron type
  nextRunAt: Date;
  lastRunAt?: Date;
  lastResult?: "success" | "failure";
  lastError?: string;
  enabled: boolean;
  payload: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
}

export interface SchedulerStats {
  totalJobs: number;
  enabled: number;
  dueNow: number;
  successRate: number;
  nextRun?: Date;
}

export class SchedulerService {
  private jobs: Map<string, ScheduledJob> = new Map();
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Register a new scheduled job
   */
  addJob(job: Omit<ScheduledJob, "lastRunAt" | "lastResult" | "lastError" | "retryCount" | "createdAt">): ScheduledJob {
    const fullJob: ScheduledJob = {
      ...job,
      retryCount: 0,
      maxRetries: job.maxRetries ?? 3,
      createdAt: new Date(),
    };
    this.jobs.set(job.id, fullJob);
    return fullJob;
  }

  /**
   * Remove a job
   */
  removeJob(id: string): boolean {
    return this.jobs.delete(id);
  }

  /**
   * Enable/disable a job
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.enabled = enabled;
    return true;
  }

  /**
   * Get jobs due for execution
   */
  getDueJobs(): ScheduledJob[] {
    const now = new Date();
    return Array.from(this.jobs.values()).filter(
      j => j.enabled && j.nextRunAt <= now
    );
  }

  /**
   * Mark job as completed and compute next run
   */
  markCompleted(id: string, success: boolean, error?: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.lastRunAt = new Date();
    job.lastResult = success ? "success" : "failure";
    job.lastError = error;

    if (success) {
      job.retryCount = 0;
      job.nextRunAt = this.computeNextRun(job);
    } else {
      job.retryCount++;
      if (job.retryCount >= job.maxRetries) {
        job.enabled = false; // Auto-disable after max retries
      } else {
        // Exponential backoff: 1min, 4min, 16min...
        const delay = Math.pow(4, job.retryCount) * 60_000;
        job.nextRunAt = new Date(Date.now() + delay);
      }
    }
  }

  /**
   * Start the scheduler loop (tick every 30 seconds)
   */
  start(onTick: (dueJobs: ScheduledJob[]) => Promise<void>): void {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(async () => {
      const due = this.getDueJobs();
      if (due.length > 0) {
        await onTick(due);
      }
    }, 30_000);
  }

  /**
   * Stop the scheduler loop
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  /**
   * Get scheduler stats
   */
  getStats(): SchedulerStats {
    const all = Array.from(this.jobs.values());
    const enabled = all.filter(j => j.enabled);
    const withResults = all.filter(j => j.lastResult);
    const successes = withResults.filter(j => j.lastResult === "success").length;
    const dueNow = this.getDueJobs().length;
    const nextRun = enabled
      .map(j => j.nextRunAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      totalJobs: all.length,
      enabled: enabled.length,
      dueNow,
      successRate: withResults.length ? Math.round((successes / withResults.length) * 100) : 100,
      nextRun,
    };
  }

  // Queries
  getById(id: string): ScheduledJob | undefined { return this.jobs.get(id); }
  getByAvatar(avatarId: string): ScheduledJob[] { return Array.from(this.jobs.values()).filter(j => j.avatarId === avatarId); }
  getAll(): ScheduledJob[] { return Array.from(this.jobs.values()); }
  isRunning(): boolean { return this.running; }

  private computeNextRun(job: ScheduledJob): Date {
    const now = new Date();
    switch (job.frequency) {
      case "once": return new Date(8640000000000000); // Max date = disabled
      case "hourly": return new Date(now.getTime() + 3600_000);
      case "daily": return new Date(now.getTime() + 86400_000);
      case "weekly": return new Date(now.getTime() + 604800_000);
      case "cron": return new Date(now.getTime() + 3600_000); // Simplified; use cron-parser in production
      default: return new Date(now.getTime() + 86400_000);
    }
  }
}
