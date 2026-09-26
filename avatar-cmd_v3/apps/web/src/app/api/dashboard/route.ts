import { prisma } from "@avatar-cmd/db"
import { orchestrator } from "@avatar-cmd/core"
import { route } from "@/lib/api"
import { avatarInclude, serializeAvatar, serializeActivity, roleKey } from "@/lib/serializers"

export const dynamic = "force-dynamic"

function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// GET /api/dashboard — everything the overview page needs in one round-trip
export const GET = route(async () => {
  const today = startOfDay()
  const weekAgo = new Date(today.getTime() - 7 * 86400_000)
  const twoWeeksAgo = new Date(today.getTime() - 14 * 86400_000)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)

  const [avatars, postsToday, postsLastWeekSameDay, revenueMonth, revenuePrevMonth, automationsWeek, automationsPrevWeek, analytics, revenueByAvatar, collabs, activity, pendingImprovements, queue] =
    await Promise.all([
      prisma.avatar.findMany({ include: avatarInclude, orderBy: { createdAt: "asc" } }),
      prisma.content.count({ where: { createdAt: { gte: today } } }),
      prisma.content.count({ where: { createdAt: { gte: new Date(today.getTime() - 7 * 86400_000), lt: new Date(today.getTime() - 6 * 86400_000) } } }),
      prisma.revenue.aggregate({ where: { earnedAt: { gte: monthStart } }, _sum: { amount: true } }),
      prisma.revenue.aggregate({ where: { earnedAt: { gte: prevMonthStart, lt: monthStart } }, _sum: { amount: true } }),
      prisma.activityLog.count({ where: { action: "automation_triggered", createdAt: { gte: weekAgo } } }),
      prisma.activityLog.count({ where: { action: "automation_triggered", createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      prisma.avatarAnalytics.findMany({ where: { date: { gte: new Date(today.getTime() - 14 * 86400_000) } }, orderBy: { date: "asc" }, include: { avatar: { select: { name: true } } } }),
      prisma.revenue.groupBy({ by: ["avatarId"], where: { earnedAt: { gte: monthStart } }, _sum: { amount: true } }),
      prisma.collaboration.findMany({ where: { status: { in: ["PROPOSED", "IN_PROGRESS"] } }, select: { id: true, initiatorId: true, partnerId: true, title: true, status: true } }),
      prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { avatar: { select: { id: true, name: true, avatarImageUrl: true } } } }),
      prisma.improvementCycle.findMany({ where: { status: "pending" }, take: 5, orderBy: { createdAt: "desc" }, include: { avatar: { select: { name: true } } } }),
      orchestrator.getQueueStatus().catch(() => null),
    ])

  const pct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur ? 100 : 0)

  // Engagement trend: date × avatar
  const trendMap = new Map<string, Record<string, number | string>>()
  for (const a of analytics) {
    const key = a.date.toISOString().slice(5, 10)
    const row = trendMap.get(key) ?? { date: key }
    row[a.avatar.name] = ((row[a.avatar.name] as number) ?? 0) + a.engagements
    trendMap.set(key, row)
  }

  const revenueMap = new Map(revenueByAvatar.map((r) => [r.avatarId, r._sum.amount ?? 0]))
  const latestAnalytics = new Map<string, (typeof analytics)[number]>()
  for (const a of analytics) latestAnalytics.set(a.avatarId, a)

  const activeCount = avatars.filter((a) => a.status === "ACTIVE").length
  const revCur = revenueMonth._sum.amount ?? 0
  const revPrev = revenuePrevMonth._sum.amount ?? 0

  return {
    stats: {
      activeAvatars: activeCount,
      totalAvatars: avatars.length,
      postsToday,
      postsChange: pct(postsToday, postsLastWeekSameDay),
      revenueMonth: revCur,
      revenueChange: pct(revCur, revPrev),
      automationsWeek,
      automationsChange: pct(automationsWeek, automationsPrevWeek),
    },
    avatars: avatars.map((a) => ({
      ...serializeAvatar(a),
      roleKey: roleKey(a.role),
      revenueMonth: revenueMap.get(a.id) ?? 0,
      engagementRate: latestAnalytics.get(a.id)?.engagementRate ?? 0,
      healthScore: a.snsAccounts.length ? Math.round(a.snsAccounts.reduce((s, x) => s + x.healthScore, 0) / a.snsAccounts.length) : 100,
    })),
    engagementTrend: [...trendMap.values()],
    collaborations: collabs,
    activity: activity.map(serializeActivity),
    improvements: pendingImprovements.map((c) => ({ id: c.id, avatarName: c.avatar.name, suggestions: c.suggestions, triggerType: c.triggerType })),
    queue: queue ? { backend: queue.backend, pending: queue.pending, processing: queue.processing, failed: queue.failed } : null,
  }
})
