import { prisma } from "@avatar-cmd/db"
import { orchestrator, isAiConfigured, getModelName, getPublishMode, getChromePoolStatus, getAvatarsBaseDir } from "@avatar-cmd/core"
import { route } from "@/lib/api"

export const dynamic = "force-dynamic"

// GET /api/system — runtime configuration & health for the settings page
export const GET = route(async () => {
  let db = "ok"
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    db = "error"
  }
  const [queue, chrome, auditCount] = await Promise.all([
    orchestrator.getQueueStatus().catch(() => null),
    getChromePoolStatus(),
    prisma.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
  ])
  return {
    db,
    queue,
    ai: { configured: isAiConfigured(), model: isAiConfigured() ? getModelName() : "mock" },
    publishMode: getPublishMode(),
    encryption: !!process.env.ENCRYPTION_KEY,
    chromeEmpire: { online: chrome.online, updatedAt: chrome.updatedAt ?? null },
    schedulerTickMs: Number(process.env.SCHEDULER_TICK_MS || 30000),
    avatarDataDir: getAvatarsBaseDir(),
    auditEvents24h: auditCount,
    version: "3.1.0",
  }
})
