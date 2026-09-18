// ================================================
// 認証ミドルウェア
// ================================================
// ダッシュボードと API を未認証アクセスから保護する。
// Edge で動くため lib/auth.config.ts (Prisma/bcrypt を含まない) を使う。

import NextAuth, { type NextAuthResult } from "next-auth";
import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";
import { authConfig, isPublicPath } from "@/lib/auth.config";

// pnpm 環境では NextAuth() の戻り値を推論できない (TS2742) ため明示的に注釈する
const nextAuth: NextAuthResult = NextAuth(authConfig);

const authHandler = nextAuth.auth((request) => {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname) || request.auth?.user) {
    return NextResponse.next();
  }

  // API は fetch から呼ばれるため、ログインページへ飛ばさず 401 JSON を返す
  // （リダイレクトすると呼び出し側が HTML を受け取ってしまう）
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.nextUrl.origin);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
});

// nextAuth.auth() が返すのは App Router のルートハンドラ型で、Next.js が
// ミドルウェアに渡す引数とは型が一致しない（実行時の引数は互換）。
// pnpm 環境では推論結果を名前で表現できない (TS2742) ため、
// next/server の型で包み直す。
export const middleware = (request: NextRequest, event: NextFetchEvent) =>
  (authHandler as unknown as NextMiddleware)(request, event);

export const config = {
  // 静的アセットと画像最適化を除く全パスを対象にする
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
