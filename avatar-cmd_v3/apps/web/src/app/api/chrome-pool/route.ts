import { getChromePoolStatus, getChromeQueueCounts } from "@avatar-cmd/core"
import { route } from "@/lib/api"

export const dynamic = "force-dynamic"

// GET /api/chrome-pool — live status published by the Chrome Empire worker via Redis
export const GET = route(async () => {
  const [pool, queue] = await Promise.all([getChromePoolStatus(), getChromeQueueCounts().catch(() => null)])
  return {
    redisConfigured: !!process.env.REDIS_URL,
    workerOnline: pool.online,
    updatedAt: pool.updatedAt ?? null,
    queue,
    ...((pool.status as object) ?? {
      totalInstances: 0,
      activeInstances: 0,
      idleInstances: 0,
      errorInstances: 0,
      totalMemoryMB: 0,
      maxInstances: Number(process.env.CHROME_POOL_SIZE || 3),
      instances: [],
    }),
  }
})
