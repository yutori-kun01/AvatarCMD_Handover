import { prisma } from "@avatar-cmd/db"
import { route } from "@/lib/api"

export const dynamic = "force-dynamic"

export const DELETE = route(async (_req, { params, userId }) => {
  await prisma.snsAccount.delete({ where: { id: params.id } })
  await prisma.auditLog.create({ data: { userId, action: "credential_removed", resource: "sns_account", resourceId: params.id } })
  return { success: true }
})
