import { prisma } from "@avatar-cmd/db"
import { orchestrator } from "@avatar-cmd/core"
import { route, notFound, ApiError } from "@/lib/api"

export const dynamic = "force-dynamic"

export const DELETE = route(async (_req, { params }) => {
  await prisma.knowledgeItem.delete({ where: { id: params.id } })
  return { success: true }
})

// POST /api/knowledge/[id] — re-fetch the source URL
export const POST = route(async (_req, { params }) => {
  const item = await prisma.knowledgeItem.findUnique({ where: { id: params.id } })
  if (!item) notFound("知識アイテム")
  if (!item.sourceUrl) throw new ApiError(400, "URLが登録されていません")
  const jobId = await orchestrator.addJob("fetch_knowledge", { avatarId: item.avatarId, data: { knowledgeId: item.id, url: item.sourceUrl } })
  return { success: true, jobId }
})
