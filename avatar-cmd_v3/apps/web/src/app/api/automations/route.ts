import { z } from "zod"
import { prisma, type Prisma } from "@avatar-cmd/db"
import { route, parseBody, ApiError } from "@/lib/api"
import { serializeAutomation } from "@/lib/serializers"
import { ACTION_TYPES, triggerConfigSchema, actionConfigSchema, legacyTrigger } from "@/lib/automation-schemas"

export const dynamic = "force-dynamic"

export const GET = route(async (req) => {
  const avatarId = req.nextUrl.searchParams.get("avatarId")
  const rules = await prisma.automationRule.findMany({
    where: avatarId ? { avatarId } : {},
    include: { avatar: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  })
  return rules.map(serializeAutomation)
})

const createSchema = z.object({
  avatarId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullish(),
  category: z.enum(["posting", "knowledge", "monetize", "safety", "analytics"]).default("posting"),
  triggerConfig: triggerConfigSchema.optional(),
  actionType: z.enum(ACTION_TYPES).optional(),
  actionConfig: actionConfigSchema.optional(),
  // v2 compatibility
  trigger: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
})

export const POST = route(async (req) => {
  const body = await parseBody(req, createSchema)
  const avatar = await prisma.avatar.findUnique({ where: { id: body.avatarId }, select: { id: true } })
  if (!avatar) throw new ApiError(400, "アバターが存在しません")
  const triggerConfig = body.triggerConfig ?? legacyTrigger(body.trigger)
  if (!triggerConfig) throw new ApiError(400, "トリガー設定が不正です（例: 毎60分 / cron）")
  const actionType = body.actionType ?? (body.action === "post:generate" ? "generate_post" : undefined)
  if (!actionType) throw new ApiError(400, "アクションが不正です")

  const rule = await prisma.automationRule.create({
    data: {
      avatarId: body.avatarId,
      name: body.name,
      description: body.description ?? null,
      category: body.category,
      triggerType: "schedule",
      triggerConfig: triggerConfig as Prisma.InputJsonValue,
      actionType,
      actionConfig: (body.actionConfig ?? {}) as Prisma.InputJsonValue,
    },
    include: { avatar: { select: { id: true, name: true } } },
  })
  await prisma.activityLog.create({
    data: { avatarId: body.avatarId, action: "automation_created", category: "system", description: `自動化ルール「${rule.name}」を作成しました` },
  })
  return Response.json(serializeAutomation(rule), { status: 201 })
})
