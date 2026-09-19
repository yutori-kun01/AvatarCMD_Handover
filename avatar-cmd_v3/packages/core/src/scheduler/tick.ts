// ================================================
// スケジューラ tick — 定期実行の発火
// ================================================
// worker プロセスが一定間隔で呼ぶ。2つの仕事をする。
//   1. AutomationRule (triggerType=schedule) の cron を評価してジョブ投入
//   2. 期限が来た ScheduledPost を publish_post として投入
//   3. PUBLISHING のまま放置された Content を FAILED に倒す
//
// BullMQ の繰り返しジョブではなく DB を正とする tick 方式にしている。
// ルールは実行中に追加・変更・無効化されるため、BullMQ 側の
// スケジュール登録と DB を同期させ続けるより単純で壊れにくい。
//
// worker を複数レプリカにしても二重投入しないよう Redis ロックで排他する。

import { CronExpressionParser } from "cron-parser";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { enqueueAppJob, withLock, type AppJobType } from "@avatar-cmd/queue";

/** actionType → 投入するジョブ種別 */
const ACTION_TO_JOB: Record<string, AppJobType> = {
  post: "generate_post",
  generate: "generate_post",
  publish: "publish_post",
  scrape: "fetch_knowledge",
  knowledge: "fetch_knowledge",
};

export interface TickResult {
  rulesEvaluated: number;
  rulesFired: number;
  scheduledPostsFired: number;
  stalePublishing: number;
  skipped: boolean;
}

/** PUBLISHING のまま放置とみなすまでの時間（既定15分） */
function stalePublishingMs(): number {
  const raw = Number(process.env.PUBLISHING_TIMEOUT_MS ?? 15 * 60_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60_000;
}

/**
 * cron 式から「前回の実行予定時刻」を求め、それが基準時刻より後なら
 * 発火すべきと判断する。
 * lastExecutedAt が無いルールは初回 tick では発火させない
 * （デプロイ直後に過去分がまとめて走るのを避ける）。
 */
function shouldFire(cron: string, lastExecutedAt: Date | null, now: Date): boolean {
  const interval = CronExpressionParser.parse(cron, { currentDate: now });
  const previous = interval.prev().toDate();

  if (!lastExecutedAt) return false;
  return previous > lastExecutedAt;
}

function cronOf(triggerConfig: Prisma.JsonValue): string | null {
  if (!triggerConfig || typeof triggerConfig !== "object" || Array.isArray(triggerConfig)) {
    return null;
  }
  const cron = (triggerConfig as Record<string, unknown>).cron;
  return typeof cron === "string" && cron.trim() ? cron.trim() : null;
}

async function fireScheduledRules(now: Date): Promise<{ evaluated: number; fired: number }> {
  const rules = await prisma.automationRule.findMany({
    where: { isActive: true, triggerType: "schedule" },
  });

  let fired = 0;

  for (const rule of rules) {
    const cron = cronOf(rule.triggerConfig);
    if (!cron) {
      console.warn(`[Tick] Rule ${rule.id} has no cron in triggerConfig; skipping`);
      continue;
    }

    let due: boolean;
    try {
      due = shouldFire(cron, rule.lastExecutedAt, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Tick] Rule ${rule.id} has an invalid cron (${cron}): ${message}`);
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { lastError: `cron の解析に失敗しました: ${message}` },
      });
      continue;
    }

    // 初回は基準時刻を入れるだけにして、次の tick から発火させる
    if (!rule.lastExecutedAt) {
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { lastExecutedAt: now },
      });
      continue;
    }

    if (!due) continue;

    const jobType = ACTION_TO_JOB[rule.actionType];
    if (!jobType) {
      console.warn(`[Tick] Rule ${rule.id} has unknown actionType: ${rule.actionType}`);
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { lastError: `未対応の actionType: ${rule.actionType}` },
      });
      continue;
    }

    const actionConfig =
      rule.actionConfig && typeof rule.actionConfig === "object" && !Array.isArray(rule.actionConfig)
        ? (rule.actionConfig as Record<string, unknown>)
        : {};

    const jobId = await enqueueAppJob(jobType, {
      avatarId: rule.avatarId,
      automationId: rule.id,
      data: actionConfig,
    });

    await prisma.automationRule.update({
      where: { id: rule.id },
      data: {
        lastExecutedAt: now,
        executionCount: { increment: 1 },
        lastError: null,
      },
    });

    await prisma.activityLog.create({
      data: {
        avatarId: rule.avatarId,
        action: "automation_triggered",
        category: "system",
        description: `自動化ルール「${rule.name}」が発火し ${jobType} を投入しました`,
        metadata: { ruleId: rule.id, jobId, jobType },
        level: "info",
      },
    });

    fired++;
    console.log(`[Tick] Rule ${rule.id} (${rule.name}) fired -> ${jobType} job ${jobId}`);
  }

  return { evaluated: rules.length, fired };
}

async function firePendingScheduledPosts(now: Date): Promise<number> {
  const due = await prisma.scheduledPost.findMany({
    where: { status: "pending", scheduledAt: { lte: now } },
    select: { id: true, contentId: true, content: { select: { avatarId: true } } },
    take: 50,
  });

  let fired = 0;

  for (const post of due) {
    // 先に processing にしてから投入する。順序を逆にすると、
    // 投入直後にクラッシュした場合に二重投入になる
    const claimed = await prisma.scheduledPost.updateMany({
      where: { id: post.id, status: "pending" },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // 他のレプリカが先に取った

    const jobId = await enqueueAppJob("publish_post", {
      avatarId: post.content.avatarId,
      data: { contentId: post.contentId },
    });

    fired++;
    console.log(`[Tick] ScheduledPost ${post.id} due -> publish_post job ${jobId}`);
  }

  return fired;
}

/**
 * ブラウザ投稿へ回したまま結果が返ってこない Content を FAILED にする。
 * chrome-empire が落ちた場合などに PUBLISHING のまま残るのを防ぐ。
 */
async function failStalePublishing(now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - stalePublishingMs());

  const stale = await prisma.content.findMany({
    where: { status: "PUBLISHING", updatedAt: { lt: threshold } },
    select: { id: true, avatarId: true, platform: true },
    take: 50,
  });

  for (const content of stale) {
    const message = "ブラウザ投稿の結果が返らなかったため失敗として扱います";

    // 同時に browser_result が来た場合に上書きしないよう条件付きで更新する
    const updated = await prisma.content.updateMany({
      where: { id: content.id, status: "PUBLISHING" },
      data: { status: "FAILED" },
    });
    if (updated.count === 0) continue;

    await prisma.scheduledPost.updateMany({
      where: { contentId: content.id },
      data: { status: "failed", lastError: message },
    });
    await prisma.activityLog.create({
      data: {
        avatarId: content.avatarId,
        action: "post_failed",
        category: "sns",
        description: `${content.platform}: ${message}`,
        metadata: { contentId: content.id, reason: "publishing_timeout" },
        level: "error",
      },
    });
    console.warn(`[Tick] Content ${content.id} stuck in PUBLISHING -> FAILED`);
  }

  return stale.length;
}

/**
 * tick を1回実行する。Redis ロックが取れなかった場合は skipped=true。
 */
export async function runSchedulerTick(now = new Date()): Promise<TickResult> {
  const lockTtl = Number(process.env.SCHEDULER_TICK_MS ?? 30_000);

  const result = await withLock("scheduler-tick", Math.max(lockTtl, 10_000), async () => {
    const rules = await fireScheduledRules(now);
    const scheduledPostsFired = await firePendingScheduledPosts(now);
    const stalePublishing = await failStalePublishing(now);
    return {
      rulesEvaluated: rules.evaluated,
      rulesFired: rules.fired,
      scheduledPostsFired,
      stalePublishing,
      skipped: false,
    };
  });

  return (
    result ?? {
      rulesEvaluated: 0,
      rulesFired: 0,
      scheduledPostsFired: 0,
      stalePublishing: 0,
      skipped: true,
    }
  );
}
