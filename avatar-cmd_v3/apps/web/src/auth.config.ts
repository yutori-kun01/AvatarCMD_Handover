// Edge-safe Auth.js config (used by middleware). No DB / bcrypt imports here.
import type { NextAuthConfig } from "next-auth"
import { NextResponse } from "next/server"

const PUBLIC_API = ["/api/auth", "/api/health"]

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl
      if (PUBLIC_API.some((p) => pathname.startsWith(p))) return true
      const loggedIn = !!auth?.user
      if (pathname.startsWith("/api/")) {
        return loggedIn ? true : NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      if (pathname.startsWith("/dashboard")) return loggedIn
      if (pathname === "/login" && loggedIn) {
        return NextResponse.redirect(new URL("/dashboard", request.nextUrl))
      }
      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role ?? "VIEWER"
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        ;(session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
} satisfies NextAuthConfig
