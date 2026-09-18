// ================================================
// NextAuth v5 — Edge 実行可能な共通設定
// ================================================
// middleware は Edge ランタイムで動くため、Prisma や bcrypt を
// 読み込む設定 (lib/auth.ts) をそのまま使えない。
// JWT の検証だけで足りる部分をこちらに切り出す。

import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@avatar-cmd/db";

/** 未認証でもアクセスできるパス（マーケティングLP・ブログ・認証API） */
const PUBLIC_PATHS = ["/", "/login", "/blog", "/api/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`))
  );
}

export const authConfig: NextAuthConfig = {
  // Credentials プロバイダは DB セッションを使えないため JWT 戦略を使う
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/login" },
  trustHost: true,
  // プロバイダ実体は lib/auth.ts 側で注入する
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as UserRole;
      return session;
    },
  },
};
