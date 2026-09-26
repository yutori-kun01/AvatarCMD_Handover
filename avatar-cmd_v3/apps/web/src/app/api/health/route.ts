import { prisma } from "@avatar-cmd/db"

export const dynamic = "force-dynamic"

// Public liveness/readiness probe (used by Docker healthcheck)
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json({ status: "ok" })
  } catch {
    return Response.json({ status: "degraded", db: "unreachable" }, { status: 503 })
  }
}
