import { z } from "zod"
import { prisma, type Prisma } from "@avatar-cmd/db"
import { route, parseBody } from "@/lib/api"
import { serializeAutomation } from "@/lib/serializers"
import { triggerConfigSchema, actionConfigSchema, ACTION_TYPES } from "@/lib/automation-schemas"

export const dynamic = "force-dynamic"

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).nullable(),
    category: z.enum(["posting", "knowledge", "monetize", "safety", "analytics"]),
    status: z.enum(["ACTIVE", "PAUSED"]),
    isActive: z.boolean(),
    triggerConfig: triggerConfigSchema,
    actionType: z.enum(ACTION_TYPES),
    actionConfig: actionConfigSchema,
    avatarId: z.string().min(1),
  })
  .partial()
  .strict()

export const PATCH = route(async (req, { params }) => {
  const { status, isActive, triggerConfig, actionConfig, ...rest } = await parseBody(req, patchSchema)
  const active = isActive ?? (status ? status === "ACTIVE" : undefined)
  const rule = await prisma.automationRule.update({
    where: { id: params.id },
    data: {
      ...rest,
      ...(active !== undefined ? { isActive: active, lastError: null } : {}),
      ...(triggerConfig ? { triggerConfig: triggerConfig as Prisma.InputJsonValue } : {}),
      ...(actionConfig ? { actionConfig: actionConfig as Prisma.InputJsonValue } : {}),
    },
    include: { avatar: { select: { id: true, name: true } } },
  })
  return serializeAutomation(rule)
})

export const DELETE = route(async (_req, { params }) => {
  const rule = await prisma.automationRule.delete({ where: { id: params.id } })
  await prisma.activityLog.create({
    data: { avatarId: rule.avatarId, action: "automation_deleted", category: "system", description: `自動化ルール「${rule.name}」を削除しました` },
  })
  return { success: true }
})
