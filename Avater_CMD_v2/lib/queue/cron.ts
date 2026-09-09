import { prisma } from "@/lib/prisma";
import { orchestrator } from "./orchestrator";

let isCronRunning = false;

export function startCron() {
  if (isCronRunning) return;
  isCronRunning = true;
  console.log("[Cron] Starting background automation daemon...");

  // 60秒ごとにルールを評価する
  setInterval(() => {
    evaluateAutomations().catch(console.error);
  }, 60 * 1000);
}

async function evaluateAutomations() {
  const activeRules = await prisma.automation.findMany({
    where: { status: "ACTIVE" },
  });

  if (activeRules.length === 0) return; // ルール0件ならスキップ

  const now = new Date();

  for (const rule of activeRules) {
    let targetDiffMs = 0;

    if (rule.trigger.startsWith("schedule:demo_")) {
      const secStr = rule.trigger.replace("schedule:demo_", "").replace("sec", "");
      targetDiffMs = parseInt(secStr, 10) * 1000;
    } else if (rule.trigger.startsWith("schedule:every_")) {
      const minutesStr = rule.trigger.replace("schedule:every_", "").replace("min", "");
      targetDiffMs = parseInt(minutesStr, 10) * 60 * 1000;
    }

    if (targetDiffMs > 0) {
      const lastRun = rule.lastRunAt ? rule.lastRunAt.getTime() : 0;
      const diffMs = now.getTime() - lastRun;
      
      if (diffMs >= targetDiffMs) {
        console.log(`[Cron] Triggering rule ${rule.id} (${rule.name})`);
        
        await orchestrator.addJob(rule.action as any, {
          avatarId: rule.avatarId,
          automationId: rule.id,
          data: { topic: rule.description || "日々の気づき" }
        });

        // 最後に実行した時間を更新
        await prisma.automation.update({
          where: { id: rule.id },
          data: { lastRunAt: now },
        });
      }
    }
  }
}
