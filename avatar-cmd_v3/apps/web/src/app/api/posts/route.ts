import { z } from "zod"
import { prisma, type Prisma } from "@avatar-cmd/db"
import { orchestrator } from "@avatar-cmd/core"
import { route, parseBody, ApiError, zDateString } from "@/lib/api"
import { serializePost } from "@/lib/serializers"

export const dynamic = "force-dynamic"

const STATUSES = ["DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "ARCHIVED"] as const

// GET /api/posts?avatarId=&platform=&status=&limit=
export const GET = route(async (req) => {
  const sp = req.nextUrl.searchParams
  const where: Prisma.ContentWhereInput = {}
  if (sp.get("avatarId")) where.avatarId = sp.get("avatarId")!
  if (sp.get("platform")) where.platform = sp.get("platform")!.toLowerCase()
  const status = sp.get("status")?.toUpperCase()
  if (status && (STATUSES as readonly string[]).includes(status)) where.status = status as (typeof STATUSES)[number]
  const take = Math.min(Number(sp.get("limit")) || 100, 200)
  const posts = await prisma.content.findMany({
    where,
    include: { avatar: { select: { id: true, name: true, avatarImageUrl: true } }, scheduledPost: true },
    orderBy: { createdAt: "desc" },
    take,
  })
  return posts.map(serializePost)
})

const createSchema = z.object({
  avatarId: z.string().min(1),
  platform: z.string().trim().toLowerCase().min(1).max(30),
  content: z.string().trim().min(1).max(100_000),
  // v2 UI sends PUBLISHED for "即時配信" and SCHEDULED for "スケジュール"
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED"]).optional(),
  scheduledAt: zDateString.optional(),
  category: z.string().max(30).optional(),
})

// POST /api/posts — create; "PUBLISHED" enqueues a publish job, "SCHEDULED" creates a ScheduledPost
export const POST = route(async (req) => {
  const body = await parseBody(req, createSchema)
  const avatar = await prisma.avatar.findUnique({ where: { id: body.avatarId }, select: { id: true } })
  if (!avatar) throw new ApiError(400, "アバターが存在しません")

  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
  if (body.status === "SCHEDULED" && !scheduledAt) throw new ApiError(400, "スケジュール投稿には配信日時が必要です")
  const status = body.status === "SCHEDULED" ? "SCHEDULED" : "DRAFT"

  const post = await prisma.content.create({
    data: {
      avatarId: body.avatarId,
      platform: body.platform,
      content: body.content,
      category: body.category ?? "viral",
      status,
      metadata: { createdVia: "manual" },
      ...(status === "SCHEDULED" && scheduledAt ? { scheduledPost: { create: { scheduledAt } } } : {}),
    },
    include: { avatar: { select: { id: true, name: true, avatarImageUrl: true } }, scheduledPost: true },
  })

  await prisma.activityLog.create({
    data: {
      avatarId: body.avatarId,
      action: "post_created",
      category: "content",
      description: `${body.platform} 投稿を${status === "SCHEDULED" ? "予約" : "作成"}しました: ${body.content.slice(0, 60)}`,
      metadata: { contentId: post.id },
    },
  })

  let jobId: string | undefined
  if (body.status === "PUBLISHED") {
    jobId = await orchestrator.addJob("publish_post", { avatarId: body.avatarId, contentId: post.id })
  }
  return Response.json({ ...serializePost(post), jobId }, { status: 201 })
})
