import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { route, parseBody, ApiError } from "@/lib/api"

export const dynamic = "force-dynamic"

const include = {
  initiator: { select: { id: true, name: true, avatarImageUrl: true, role: true } },
  partner: { select: { id: true, name: true, avatarImageUrl: true, role: true } },
} as const

export const GET = route(async () => {
  return prisma.collaboration.findMany({ include, orderBy: { updatedAt: "desc" } })
})

const createSchema = z.object({
  initiatorId: z.string().min(1),
  partnerId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  platform: z.string().max(30).nullish(),
})

export const POST = route(async (req) => {
  const body = await parseBody(req, createSchema)
  if (body.initiatorId === body.partnerId) throw new ApiError(400, "同じアバター同士のコラボは作成できません")
  const collab = await prisma.collaboration.create({
    data: { ...body, description: body.description ?? null, platform: body.platform ?? null, status: "PROPOSED" },
    include,
  })
  await prisma.activityLog.create({
    data: {
      avatarId: body.initiatorId,
      action: "collab_created",
      category: "content",
      description: `コラボ「${body.title}」を提案 (${collab.initiator.name} → ${collab.partner.name})`,
    },
  })
  return Response.json(collab, { status: 201 })
})
