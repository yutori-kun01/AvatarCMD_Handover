import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { CredentialVault } from "@avatar-cmd/core"
import { route, parseBody, notFound, ApiError } from "@/lib/api"

export const dynamic = "force-dynamic"

function vault(): CredentialVault {
  try {
    return new CredentialVault()
  } catch {
    throw new ApiError(500, "ENCRYPTION_KEY が設定されていないため資格情報を保存できません")
  }
}

// GET: SNS accounts for the avatar (secrets never returned)
export const GET = route(async (_req, { params }) => {
  const accounts = await prisma.snsAccount.findMany({ where: { avatarId: params.id }, orderBy: { createdAt: "asc" } })
  return accounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    accountName: a.accountName,
    authType: a.authType,
    isActive: a.isActive,
    followerCount: a.followerCount,
    healthScore: a.healthScore,
    hasAccessToken: !!a.accessToken,
    lastError: a.lastError,
  }))
})

const createSchema = z.object({
  platform: z.string().trim().toLowerCase().min(1).max(30),
  accountName: z.string().trim().min(1).max(100),
  authType: z.enum(["oauth", "session", "app_password", "api_key", "cookie"]).default("oauth"),
  accessToken: z.string().max(4000).optional(),
  refreshToken: z.string().max(4000).optional(),
  followerCount: z.number().int().min(0).optional(),
})

// POST: connect an account; tokens are AES-256-GCM encrypted at rest
export const POST = route(async (req, { params, userId }) => {
  const avatar = await prisma.avatar.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!avatar) notFound("アバター")
  const body = await parseBody(req, createSchema)
  const v = body.accessToken || body.refreshToken ? vault() : null
  const account = await prisma.snsAccount.create({
    data: {
      avatarId: params.id,
      platform: body.platform,
      accountName: body.accountName,
      authType: body.authType,
      followerCount: body.followerCount ?? 0,
      accessToken: body.accessToken && v ? v.encrypt(body.accessToken) : null,
      refreshToken: body.refreshToken && v ? v.encrypt(body.refreshToken) : null,
    },
  })
  await prisma.auditLog.create({ data: { userId, action: "credential_changed", resource: "sns_account", resourceId: account.id, details: { platform: body.platform } } })
  return Response.json({ id: account.id, platform: account.platform, accountName: account.accountName, hasAccessToken: !!account.accessToken }, { status: 201 })
})
