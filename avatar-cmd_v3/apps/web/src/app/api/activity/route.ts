import { prisma, type Prisma } from "@avatar-cmd/db"
import { route } from "@/lib/api"
import { serializeActivity } from "@/lib/serializers"

export const dynamic = "force-dynamic"

// GET /api/activity?avatarId=&category=&limit=
export const GET = route(async (req) => {
  const sp = req.nextUrl.searchParams
  const where: Prisma.ActivityLogWhereInput = {}
  if (sp.get("avatarId")) where.avatarId = sp.get("avatarId")!
  if (sp.get("category")) where.category = sp.get("category")!
  const take = Math.min(Number(sp.get("limit")) || 100, 300)
  const logs = await prisma.activityLog.findMany({
    where,
    include: { avatar: { select: { id: true, name: true, avatarImageUrl: true } } },
    orderBy: { createdAt: "desc" },
    take,
  })
  return logs.map(serializeActivity)
})
