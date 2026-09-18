// ================================================
// NextAuth v5 (Auth.js) — 認証設定
// ================================================
// 計画書「6. セキュリティ対策 / 4. 認証・認可」に対応。
// ダッシュボードと API をロール (OWNER/ADMIN/OPERATOR/VIEWER) で保護する。
//
// プロバイダは Credentials (メール + パスワード) のみ。
// User.passwordHash を bcrypt で検証する。外部IdPを使う場合は
// providers に追加し、DB セッションへの切り替えを検討する。

import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@avatar-cmd/db";
import { authConfig } from "@/lib/auth.config";

// pnpm 環境では NextAuth() の戻り値を推論できない (TS2742) ため明示的に注釈する
const nextAuth: NextAuthResult = NextAuth({
  ...authConfig,
  // 生成先を packages/db/generated/client に固定しているため、アダプタが
  // 期待する @prisma/client の PrismaClient とは名目上別の型になる。
  // 実体は同じクライアントなので、ここだけ型を合わせる。
  adapter: PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]),
  providers: [
    Credentials({
      credentials: {
        email: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });

        // ユーザー不在時もハッシュ比較を実行し、存在有無で応答時間が
        // 変わらないようにする（ユーザー列挙対策）
        const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
        const ok = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});

// 各プロパティも個別に注釈する（NextAuthResult["auth"] 経由で参照可能にする）
export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
