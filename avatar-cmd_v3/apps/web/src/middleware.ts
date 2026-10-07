// ================================================
// 認証ミドルウェア — ダッシュボードと API はログイン必須
// ================================================
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const PROTECTED_PAGES = ["/dashboard", "/avatars", "/revenue", "/automation", "/settings", "/posts", "/knowledge", "/video"];

function isPublicApi(pathname: string) {
  // OAuth コールバックは別ブラウザ（未ログイン）からも戻ってくる。1回限りの state で検証するのでログイン不要
  // 外部 AI 用 API（/api/v1）は Cookie ではなく API キーで認証する（ルート側で検証）
  return pathname.startsWith("/api/auth/") || pathname.startsWith("/api/v1/") || /^\/api\/oauth\/[^/]+\/callback$/.test(pathname);
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPage = PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if ((!isApi && !isPage) || isPublicApi(pathname)) return NextResponse.next();

  let ok = false;
  try {
    ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    ok = false;
  }
  if (ok) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|media/|favicon|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
