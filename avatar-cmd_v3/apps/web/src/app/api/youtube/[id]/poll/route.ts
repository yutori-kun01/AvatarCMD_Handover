import { NextResponse } from "next/server";
import { pollChannel } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 今すぐ新しい動画を確認する（フィードの読み取りのみ。要約は動画ごとに行う）
export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ added: await pollChannel(id) });
});
