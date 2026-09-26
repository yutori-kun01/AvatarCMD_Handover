import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { authConfig } from "./auth.config"

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
})

// Simple in-process brute-force limiter: 10 failures / 15 min per email
const failures = new Map<string, { count: number; first: number }>()
const WINDOW = 15 * 60_000
function tooManyAttempts(key: string): boolean {
  const f = failures.get(key)
  if (!f) return false
  if (Date.now() - f.first > WINDOW) {
    failures.delete(key)
    return false
  }
  return f.count >= 10
}
function recordFailure(key: string) {
  const f = failures.get(key)
  if (!f || Date.now() - f.first > WINDOW) failures.set(key, { count: 1, first: Date.now() })
  else f.count++
}

class RateLimited extends CredentialsSignin {
  code = "rate_limited"
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null
        const email = parsed.data.email.toLowerCase()
        if (tooManyAttempts(email)) throw new RateLimited()

        const user = await prisma.user.findUnique({ where: { email } })
        const ok = !!user?.passwordHash && (await bcrypt.compare(parsed.data.password, user.passwordHash))
        if (!user || !ok) {
          recordFailure(email)
          await prisma.auditLog.create({ data: { action: "login_failed", resource: "system", details: { email } } }).catch(() => {})
          return null
        }
        failures.delete(email)
        await prisma.auditLog.create({ data: { userId: user.id, action: "login", resource: "system" } }).catch(() => {})
        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
})
