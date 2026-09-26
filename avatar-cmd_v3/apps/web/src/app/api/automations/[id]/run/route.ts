import { prisma } from "@avatar-cmd/db"
import { orchestrator, isValidJobType } from "@avatar-cmd/core"
import { route, notFound, ApiError } from "@/lib/api"

export const dynamic = "force-dynamic"

// POST /api/automations/[id]/run — execute the rule's action now
export const POST = route(async (_req, { params }) => {
  const rule = await prisma.automationRule.findUnique({ where: { id: params.id } })
  if (!rule) notFound("自動化ルール")
  if (!isValidJobType(rule.actionType)) throw new ApiError(400, `未対応のアクション: ${rule.actionType}`)
  const jobId = await orchestrator.addJob(rule.actionType, {
    avatarId: rule.avatarId,
    automationId: rule.id,
    data: { topic: rule.description || "日々の気づき", ...((rule.actionConfig ?? {}) as Record<string, unknown>) },
  })
  await prisma.automationRule.update({ where: { id: rule.id }, data: { lastExecutedAt: new Date(), executionCount: { increment: 1 } } })
  await prisma.activityLog.create({
    data: { avatarId: rule.avatarId, action: "automation_triggered", category: "system", description: `自動化ルール「${rule.name}」を手動実行しました`, metadata: { automationId: rule.id, jobId } },
  })
  return { success: true, jobId }
})
