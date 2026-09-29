// 別ブラウザ用の認可 URL を発行する（URL をコピーして、接続したい SNS アカウントでログイン中のブラウザで開く）
import { NextResponse } from "next/server";
import { createOAuthLink } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request, { params }: { params: Promise<{ platform: string }> }) => {
  const { platform } = await params;
  const { avatarId } = (await req.json()) as { avatarId?: string };
  const link = await createOAuthLink(platform, avatarId ?? "");
  return NextResponse.json(link);
});
