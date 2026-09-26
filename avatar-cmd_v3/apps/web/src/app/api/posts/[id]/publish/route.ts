import { prisma } from "@avatar-cmd/db"
import { orchestrator } from "@avatar-cmd/core"
import { route, notFound, ApiError } from "@/lib/api"

export const dynamic = "force-dynamic"

// POST /api/posts/[id]/publish — enqueue immediate publication
export const POST = route(async (_req, { params }) => {
  const post = await prisma.content.findUnique({ where: { id: params.id }, select: { id: true, avatarId: true, status: true } })
  if (!post) notFound("投稿")
  if (post.status === "PUBLISHED" || post.status === "PUBLISHING") throw new ApiError(409, "既に配信済み・配信中です")
  const jobId = await orchestrator.addJob("publish_post", { avatarId: post.avatarId, contentId: post.id })
  return { success: true, jobId }
})
