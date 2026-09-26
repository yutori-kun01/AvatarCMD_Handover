import { prisma } from "@avatar-cmd/db"
import { createDefaultRegistry } from "@avatar-cmd/integrations"
import { route } from "@/lib/api"

export const dynamic = "force-dynamic"

const registry = createDefaultRegistry()

// GET /api/platforms — 16 providers (from integrations registry) + connected account counts
export const GET = route(async () => {
  const platforms = registry.listPlatformInfo()
  const accounts = await prisma.snsAccount.groupBy({ by: ["platform"], _count: true, _sum: { followerCount: true } })
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]))
  return {
    totalPlatforms: platforms.length,
    hybridCount: platforms.filter((p) => p.modes.includes("hybrid")).length,
    apiCount: platforms.filter((p) => p.modes.includes("api")).length,
    browserCount: platforms.filter((p) => p.modes.length === 1 && p.modes[0] === "browser").length,
    platforms: platforms.map((p) => ({
      ...p,
      connectedAccounts: byPlatform.get(p.platform)?._count ?? 0,
      followers: byPlatform.get(p.platform)?._sum.followerCount ?? 0,
    })),
  }
})
