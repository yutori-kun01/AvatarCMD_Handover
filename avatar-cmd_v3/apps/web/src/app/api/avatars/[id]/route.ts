import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { removeAvatarDirectory } from "@avatar-cmd/core"
import { route, parseBody, notFound } from "@/lib/api"
import { avatarInclude, serializeAvatar, serializePost, serializeActivity } from "@/lib/serializers"

export const dynamic = "force-dynamic"

export const GET = route(async (_req, { params }) => {
  const avatar = await prisma.avatar.findUnique({
    where: { id: params.id },
    include: {
      ...avatarInclude,
      contents: { orderBy: { createdAt: "desc" }, take: 20, include: { scheduledPost: true } },
      activityLogs: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  })
  if (!avatar) notFound("アバター")
  return {
    ...serializeAvatar(avatar),
    posts: avatar.contents.map(serializePost),
    activities: avatar.activityLogs.map(serializeActivity),
  }
})

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    role: z.string().trim().min(1).max(100),
    specialization: z.string().trim().max(200),
    targetAudience: z.string().trim().max(200),
    tone: z.string().trim().max(500).nullable(),
    description: z.string().trim().max(2000).nullable(),
    avatarImageUrl: z.string().url().max(500).nullable(),
    status: z.enum(["ACTIVE", "PAUSED", "LEARNING", "ERROR"]),
    writingRules: z.record(z.unknown()),
  })
  .partial()
  .strict()

export const PATCH = route(async (req, { params, userId }) => {
  const body = await parseBody(req, patchSchema)
  const before = await prisma.avatar.findUnique({ where: { id: params.id } })
  if (!before) notFound("アバター")
  const avatar = await prisma.avatar.update({
    where: { id: params.id },
    data: { ...body, writingRules: body.writingRules as object | undefined },
    include: avatarInclude,
  })
  if (body.status && body.status !== before.status) {
    await prisma.activityLog.create({
      data: {
        avatarId: avatar.id,
        action: body.status === "ACTIVE" ? "avatar_resumed" : "avatar_paused",
        category: "system",
        description: `アバター「${avatar.name}」を${body.status === "ACTIVE" ? "起動" : body.status === "PAUSED" ? "一時停止" : body.status}しました`,
      },
    })
  }
  await prisma.auditLog.create({ data: { userId, action: "avatar_updated", resource: "avatar", resourceId: avatar.id, details: { fields: Object.keys(body) } } })
  return serializeAvatar(avatar)
})

export const DELETE = route(async (_req, { params, userId }) => {
  const avatar = await prisma.avatar.findUnique({ where: { id: params.id } })
  if (!avatar) notFound("アバター")
  await prisma.avatar.delete({ where: { id: params.id } })
  await removeAvatarDirectory(params.id).catch(() => {})
  await prisma.activityLog.create({ data: { action: "avatar_deleted", category: "system", level: "warning", description: `アバター「${avatar.name}」を削除しました` } })
  await prisma.auditLog.create({ data: { userId, action: "avatar_deleted", resource: "avatar", resourceId: params.id } })
  return { success: true }
})
