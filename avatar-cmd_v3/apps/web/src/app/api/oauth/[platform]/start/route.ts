// OAuth 開始: 各SNSの認可画面へリダイレクト
import { NextResponse } from "next/server";
import { startOAuth } from "@avatar-cmd/integrations/server";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const avatarId = new URL(req.url).searchParams.get("avatarId") ?? "";
  try {
    return NextResponse.redirect(await startOAuth(platform, avatarId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(new URL(`/settings?tab=accounts&error=${encodeURIComponent(msg)}`, req.url));
  }
}
