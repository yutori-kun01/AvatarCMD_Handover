import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { ensureAvatarDirectory, writeAvatarFile } from "@avatar-cmd/core"
import { route, parseBody } from "@/lib/api"
import { avatarInclude, serializeAvatar } from "@/lib/serializers"

export const dynamic = "force-dynamic"

export const GET = route(async () => {
  const avatars = await prisma.avatar.findMany({ include: avatarInclude, orderBy: { createdAt: "asc" } })
  return avatars.map(serializeAvatar)
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  role: z.string().trim().min(1).max(100),
  specialization: z.string().trim().max(200).optional().default(""),
  targetAudience: z.string().trim().max(200).optional().default(""),
  tone: z.string().trim().max(500).nullish(),
  description: z.string().trim().max(2000).nullish(),
  avatarImageUrl: z.string().url().max(500).nullish(),
})

export const POST = route(async (req, { userId }) => {
  const body = await parseBody(req, createSchema)
  const avatar = await prisma.avatar.create({
    data: { ...body, userId, status: "PAUSED", lastSyncAt: new Date() },
    include: avatarInclude,
  })
  await ensureAvatarDirectory(avatar.id)
  await writeAvatarFile(
    avatar.id,
    "soul.md",
    `---\nname: "${body.name}"\nrole: "${body.role}"\nspecialization: "${body.specialization}"\ntarget_audience: "${body.targetAudience}"\ntone: "${body.tone ?? ""}"\nversion: "1.0"\n---\n\n# 人格の定義\n\n${body.description ?? ""}\n\n## トーン＆マナー\n- ${body.tone ?? "未設定"}\n`
  )
  await prisma.activityLog.create({
    data: { avatarId: avatar.id, action: "avatar_created", category: "system", level: "success", description: `アバター「${avatar.name}」を作成しました` },
  })
  await prisma.auditLog.create({ data: { userId, action: "avatar_created", resource: "avatar", resourceId: avatar.id } })
  return Response.json(serializeAvatar(avatar), { status: 201 })
})
