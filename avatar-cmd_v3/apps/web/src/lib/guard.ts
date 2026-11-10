// API の二重チェック（サーバー側）: middleware の署名チェックに加えて、DB のセッション（失効・期限・放置時間）と
// 他サイトからの書き込み（CSRF）を確かめる。route() から呼ぶ（lib/api.ts）。
import { NextResponse } from "next/server";
import { validateAdminSession } from "@avatar-cmd/integrations/server";
import { crossSiteWrite, readCookie, readSessionToken, SESSION_COOKIE } from "./session";

/** ログイン不要の API（ログイン・外部 AI 用 API（API キーで認証）・OAuth のコールバック） */
export function isPublicApi(pathname: string) {
  return pathname.startsWith("/api/auth/") || pathname.startsWith("/api/v1/") || /^\/api\/oauth\/[^/]+\/callback$/.test(pathname);
}

/** Cookie の sid（署名・期限まで確認済み。DB は見ない） */
export async function sessionId(req: Request): Promise<string | null> {
  return readSessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

/** ログイン中なら sid、そうでなければ null（DB のセッションまで確かめる） */
export async function currentSession(req: Request): Promise<string | null> {
  const sid = await sessionId(req);
  return sid && (await validateAdminSession(sid)) ? sid : null;
}

/** 断るときは応答を返す。通すときは null */
export async function guardApi(req: Request): Promise<Response | null> {
  if (crossSiteWrite(req)) return NextResponse.json({ error: "他のサイトからの操作は受け付けません" }, { status: 403 });
  const { pathname } = new URL(req.url);
  if (isPublicApi(pathname)) return null;
  if (!(await currentSession(req))) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  return null;
}
