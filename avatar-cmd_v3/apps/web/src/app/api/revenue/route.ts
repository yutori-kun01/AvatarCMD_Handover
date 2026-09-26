import { z } from "zod"
import { prisma, type Prisma } from "@avatar-cmd/db"
import { route, parseBody, ApiError, zDateString } from "@/lib/api"
import { serializeRevenue } from "@/lib/serializers"

export const dynamic = "force-dynamic"

// GET /api/revenue?avatarId= — recent entries + aggregates (by avatar / source / platform / month)
export const GET = route(async (req) => {
  const avatarId = req.nextUrl.searchParams.get("avatarId")
  const where: Prisma.RevenueWhereInput = { status: { not: "refunded" }, ...(avatarId ? { avatarId } : {}) }

  const [entries, totals, bySource, byPlatform, all] = await Promise.all([
    prisma.revenue.findMany({ where, include: { avatar: { select: { id: true, name: true } } }, orderBy: { earnedAt: "desc" }, take: 50 }),
    prisma.revenue.groupBy({ by: ["avatarId"], where, _sum: { amount: true }, _count: true }),
    prisma.revenue.groupBy({ by: ["source"], where, _sum: { amount: true } }),
    prisma.revenue.groupBy({ by: ["platform"], where, _sum: { amount: true } }),
    prisma.revenue.findMany({ where: { ...where, earnedAt: { gte: new Date(Date.now() - 365 * 86400_000) } }, select: { amount: true, earnedAt: true } }),
  ])

  const monthlyMap = new Map<string, number>()
  for (const r of all) {
    const m = r.earnedAt.toISOString().slice(0, 7)
    monthlyMap.set(m, (monthlyMap.get(m) ?? 0) + r.amount)
  }
  const monthly = [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, total }))
  const grand = totals.reduce((s, t) => s + (t._sum.amount ?? 0), 0)
  const last = monthly.at(-1)?.total ?? 0
  const prev = monthly.at(-2)?.total ?? 0

  return {
    entries: entries.map(serializeRevenue),
    totals,
    totalRevenue: grand,
    monthlyGrowth: prev ? Math.round(((last - prev) / prev) * 1000) / 10 : 0,
    bySource: bySource.map((s) => ({ source: s.source, total: s._sum.amount ?? 0, percentage: grand ? Math.round(((s._sum.amount ?? 0) / grand) * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total),
    byPlatform: byPlatform.map((p) => ({ platform: p.platform, total: p._sum.amount ?? 0 })).sort((a, b) => b.total - a.total),
    monthly,
  }
})

const createSchema = z.object({
  avatarId: z.string().min(1),
  type: z.string().trim().min(1).max(40),
  amount: z.number().finite().positive().max(1e10),
  description: z.string().max(500).nullish(),
  platform: z.string().max(40).nullish(),
  currency: z.string().length(3).default("JPY"),
  earnedAt: zDateString.optional(),
})

export const POST = route(async (req) => {
  const body = await parseBody(req, createSchema)
  const avatar = await prisma.avatar.findUnique({ where: { id: body.avatarId }, select: { id: true } })
  if (!avatar) throw new ApiError(400, "アバターが存在しません")
  const entry = await prisma.revenue.create({
    data: {
      avatarId: body.avatarId,
      source: body.type,
      platform: body.platform || "other",
      amount: body.amount,
      currency: body.currency,
      description: body.description ?? null,
      earnedAt: body.earnedAt ? new Date(body.earnedAt) : new Date(),
    },
  })
  await prisma.activityLog.create({
    data: { avatarId: body.avatarId, action: "revenue_earned", category: "revenue", level: "success", description: `¥${body.amount.toLocaleString()} の収益を記録 (${body.type})` },
  })
  return Response.json(serializeRevenue(entry), { status: 201 })
})
