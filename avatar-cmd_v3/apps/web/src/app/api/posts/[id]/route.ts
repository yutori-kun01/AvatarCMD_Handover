import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { route, parseBody, notFound, ApiError, zDateString } from "@/lib/api"
import { serializePost } from "@/lib/serializers"

export const dynamic = "force-dynamic"

const include = { avatar: { select: { id: true, name: true, avatarImageUrl: true } }, scheduledPost: true } as const

export const GET = route(async (_req, { params }) => {
  const post = await prisma.content.findUnique({ where: { id: params.id }, include })
  if (!post) notFound("投稿")
  return serializePost(post)
})

const patchSchema = z
  .object({
    content: z.string().trim().min(1).max(100_000),
    platform: z.string().trim().toLowerCase().min(1).max(30),
    status: z.enum(["DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "ARCHIVED"]),
    scheduledAt: zDateString.nullable(),
    category: z.string().max(30),
  })
  .partial()
  .strict()

export const PATCH = route(async (req, { params }) => {
  const body = await parseBody(req, patchSchema)
  const existing = await prisma.content.findUnique({ where: { id: params.id }, include: { scheduledPost: true } })
  if (!existing) notFound("投稿")
  if (existing.status === "PUBLISHED" || existing.status === "PUBLISHING") {
    throw new ApiError(409, "配信済み・配信中の投稿は編集できません")
  }
  const { scheduledAt, ...rest } = body
  const post = await prisma.$transaction(async (tx) => {
    if (scheduledAt !== undefined) {
      if (scheduledAt === null) {
        if (existing.scheduledPost) await tx.scheduledPost.delete({ where: { contentId: existing.id } })
        if (!rest.status && existing.status === "SCHEDULED") rest.status = "DRAFT"
      } else {
        await tx.scheduledPost.upsert({
          where: { contentId: existing.id },
          create: { contentId: existing.id, scheduledAt: new Date(scheduledAt) },
          update: { scheduledAt: new Date(scheduledAt), status: "pending", lastError: null },
        })
        rest.status = "SCHEDULED"
      }
    }
    return tx.content.update({ where: { id: params.id }, data: rest, include })
  })
  return serializePost(post)
})

export const DELETE = route(async (_req, { params }) => {
  const post = await prisma.content.findUnique({ where: { id: params.id }, select: { avatarId: true, platform: true, content: true } })
  if (!post) notFound("投稿")
  await prisma.content.delete({ where: { id: params.id } })
  await prisma.activityLog.create({
    data: { avatarId: post.avatarId, action: "post_deleted", category: "content", description: `${post.platform} の投稿を削除: ${post.content.slice(0, 60)}` },
  })
  return { success: true }
})
