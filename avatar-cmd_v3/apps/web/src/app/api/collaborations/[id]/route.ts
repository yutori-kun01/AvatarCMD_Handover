import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { route, parseBody, notFound, zDateString } from "@/lib/api"

export const dynamic = "force-dynamic"

const include = {
  initiator: { select: { id: true, name: true, role: true } },
  partner: { select: { id: true, name: true, role: true } },
} as const

export const GET = route(async (_req, { params }) => {
  const collab = await prisma.collaboration.findUnique({ where: { id: params.id }, include })
  if (!collab) notFound("コラボレーション")
  return collab
})

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable(),
    platform: z.string().max(30).nullable(),
    status: z.enum(["PROPOSED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
    startDate: zDateString.nullable(),
    endDate: zDateString.nullable(),
  })
  .partial()
  .strict()

export const PATCH = route(async (req, { params }) => {
  const { startDate, endDate, ...rest } = await parseBody(req, patchSchema)
  const before = await prisma.collaboration.findUnique({ where: { id: params.id } })
  if (!before) notFound("コラボレーション")
  const collab = await prisma.collaboration.update({
    where: { id: params.id },
    data: {
      ...rest,
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      ...(rest.status === "IN_PROGRESS" && !before.startDate ? { startDate: new Date() } : {}),
      ...(rest.status === "COMPLETED" && !before.endDate ? { endDate: new Date() } : {}),
    },
    include,
  })
  if (rest.status && rest.status !== before.status) {
    await prisma.activityLog.create({
      data: { avatarId: collab.initiatorId, action: rest.status === "IN_PROGRESS" ? "collab_started" : "collab_updated", category: "content", description: `コラボ「${collab.title}」: ${before.status} → ${rest.status}` },
    })
  }
  return collab
})

export const DELETE = route(async (_req, { params }) => {
  await prisma.collaboration.delete({ where: { id: params.id } })
  return { success: true }
})
