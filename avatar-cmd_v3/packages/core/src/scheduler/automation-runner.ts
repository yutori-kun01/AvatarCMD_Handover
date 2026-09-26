// ==============================================
// Automation Runner — evaluates AutomationRule rows on a tick
// ==============================================
// triggerType "schedule" with triggerConfig:
//   { intervalMinutes: number }   — every N minutes
//   { intervalSeconds: number }   — every N seconds (demo / testing)
//   { cron: "0 9 * * *" }         — cron expression (server TZ or TZ env)
// Legacy v2 strings in triggerConfig.legacy ("schedule:every_30min",
// "schedule:demo_30sec") are also understood.
//
// Rules are claimed with an optimistic update on lastExecutedAt so that
// multiple app instances never fire the same rule twice.

import { prisma, type AutomationRule } from "@avatar-cmd/db";
import { CronExpressionParser } from "cron-parser";
import { orchestrator, isValidJobType, type JobType } from "./orchestrator";

export interface ScheduleConfig {
  intervalMinutes?: number;
  intervalSeconds?: number;
  cron?: string;
  legacy?: string;
}

/** Returns the interval in ms, or null for cron / invalid configs. */
export function intervalMs(cfg: ScheduleConfig): number | null {
  if (cfg.intervalSeconds && cfg.intervalSeconds > 0) return cfg.intervalSeconds * 1000;
  if (cfg.intervalMinutes && cfg.intervalMinutes > 0) return cfg.intervalMinutes * 60_000;
  if (cfg.legacy) {
    const sec = cfg.legacy.match(/^schedule:demo_(\d+)sec$/);
    if (sec) return Number(sec[1]) * 1000;
    const min = cfg.legacy.match(/^schedule:every_(\d+)min$/);
    if (min) return Number(min[1]) * 60_000;
  }
  return null;
}

/** Decide whether a rule is due at `now`. */
export function isRuleDue(rule: Pick<AutomationRule, "triggerType" | "triggerConfig" | "lastExecutedAt" | "createdAt">, now: Date): boolean {
  if (rule.triggerType !== "schedule") return false;
  const cfg = (rule.triggerConfig ?? {}) as ScheduleConfig;
  const last = rule.lastExecutedAt ?? null;

  const ms = intervalMs(cfg);
  if (ms !== null) {
    return !last || now.getTime() - last.getTime() >= ms;
  }
  if (cfg.cron) {
    try {
      const from = last ?? rule.createdAt;
      const next = CronExpressionParser.parse(cfg.cron, { currentDate: from, tz: process.env.TZ }).next().toDate();
      return next.getTime() <= now.getTime();
    } catch {
      return false;
    }
  }
  return false;
}

/** Map rule actionType to a queue job type. */
function toJobType(actionType: string): JobType | null {
  const aliases: Record<string, JobType> = {
    "post:generate": "generate_post",
    generate: "generate_post",
    post: "publish_due",
    scrape: "fetch_knowledge",
  };
  const t = aliases[actionType] ?? actionType;
  return isValidJobType(t) ? t : null;
}

export async function evaluateAutomations(now = new Date()): Promise<number> {
  const rules = await prisma.automationRule.findMany({
    where: { isActive: true, triggerType: "schedule", avatar: { status: { in: ["ACTIVE", "LEARNING"] } } },
  });
  let fired = 0;
  for (const rule of rules) {
    if (!isRuleDue(rule, now)) continue;

    const claimed = await prisma.automationRule.updateMany({
      where: { id: rule.id, lastExecutedAt: rule.lastExecutedAt },
      data: { lastExecutedAt: now, executionCount: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    const jobType = toJobType(rule.actionType);
    if (!jobType) {
      await prisma.automationRule.update({ where: { id: rule.id }, data: { lastError: `Unknown actionType: ${rule.actionType}` } });
      continue;
    }
    const actionConfig = (rule.actionConfig ?? {}) as Record<string, unknown>;
    await orchestrator.addJob(jobType, {
      avatarId: rule.avatarId,
      automationId: rule.id,
      data: { topic: rule.description || "日々の気づき", ...actionConfig },
    });
    await prisma.automationRule.update({ where: { id: rule.id }, data: { lastError: null } });
    await prisma.activityLog.create({
      data: {
        avatarId: rule.avatarId,
        action: "automation_triggered",
        category: "system",
        description: `自動化ルール「${rule.name}」を実行しました`,
        metadata: { automationId: rule.id, jobType },
      },
    });
    fired++;
  }
  return fired;
}

/** Enqueue a publish job for every due scheduled post. */
export async function enqueueDueScheduledPosts(now = new Date()): Promise<number> {
  const due = await prisma.scheduledPost.count({ where: { status: "pending", scheduledAt: { lte: now } } });
  if (due > 0) await orchestrator.addJob("publish_due", {});
  return due;
}

// ─── Daemon ───────────────────────────────────────

const g = globalThis as unknown as { __avatarCmdScheduler?: ReturnType<typeof setInterval> };

export interface StartOptions {
  tickMs?: number;
  /** also run the queue worker in this process */
  withWorker?: boolean;
}

export async function startScheduler(opts: StartOptions = {}): Promise<void> {
  if (g.__avatarCmdScheduler) return;
  const tickMs = opts.tickMs ?? Number(process.env.SCHEDULER_TICK_MS || 30_000);
  if (opts.withWorker !== false) await orchestrator.startWorker();

  let busy = false;
  let lastMaintenance = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await evaluateAutomations();
      await enqueueDueScheduledPosts();
      if (Date.now() - lastMaintenance > 24 * 3600_000) {
        lastMaintenance = Date.now();
        await orchestrator.addJob("system_maintenance", {});
      }
    } catch (e) {
      console.error("[Scheduler] tick failed:", e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  };
  g.__avatarCmdScheduler = setInterval(tick, tickMs);
  setTimeout(tick, 3_000);
  console.log(`[Scheduler] Started (tick ${tickMs}ms)`);
}

export function stopScheduler(): void {
  if (g.__avatarCmdScheduler) clearInterval(g.__avatarCmdScheduler);
  g.__avatarCmdScheduler = undefined;
}
