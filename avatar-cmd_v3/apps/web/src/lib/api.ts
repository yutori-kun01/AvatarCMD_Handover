import { NextResponse, type NextRequest } from "next/server"
import { z, ZodError, type ZodTypeAny } from "zod"
import { Prisma } from "@avatar-cmd/db"
import { SoulEngineError } from "@avatar-cmd/core"
import { auth } from "@/auth"

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface ApiContext {
  userId: string
  role: string
  params: Record<string, string>
}

type Handler = (req: NextRequest, ctx: ApiContext) => Promise<Response | unknown>

const WRITE_ROLES = new Set(["OWNER", "ADMIN", "OPERATOR"])

/**
 * Wraps a route handler with: session check, role check for mutations,
 * uniform JSON error handling (zod / prisma / domain errors).
 */
export function route(handler: Handler) {
  return async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
    try {
      const session = await auth()
      if (!session?.user?.id) throw new ApiError(401, "Unauthorized")
      const role = session.user.role ?? "VIEWER"
      if (req.method !== "GET" && !WRITE_ROLES.has(role)) throw new ApiError(403, "この操作を行う権限がありません")
      const params = context?.params ? await context.params : {}
      const result = await handler(req, { userId: session.user.id, role, params })
      return result instanceof Response ? result : NextResponse.json(result)
    } catch (e) {
      return errorResponse(e)
    }
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status })
  if (e instanceof ZodError) {
    return NextResponse.json({ error: "入力が不正です", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 })
  }
  if (e instanceof SoulEngineError) return NextResponse.json({ error: e.message }, { status: e.status })
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2025") return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 })
    if (e.code === "P2002") return NextResponse.json({ error: "既に存在します" }, { status: 409 })
    if (e.code === "P2003") return NextResponse.json({ error: "関連データが存在しません" }, { status: 400 })
  }
  console.error("[API] Unhandled error:", e)
  return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 })
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    throw new ApiError(400, "JSONボディが不正です")
  }
  return schema.parse(json)
}

export function notFound(what = "対象"): never {
  throw new ApiError(404, `${what}が見つかりません`)
}

/** Any string Date can parse (ISO with/without seconds/offset). */
export const zDateString = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "日時の形式が不正です")
