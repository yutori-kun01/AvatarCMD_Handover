// アバターのアイコン: mediaName を指定すると手動設定、null で接続アカウントの画像（X → Threads → …）に戻す
import { NextResponse } from "next/server";
import { setAvatarIcon } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PUT = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { mediaName?: string | null };
  return NextResponse.json({ url: await setAvatarIcon(id, b.mediaName || null) });
});
