import { NextResponse } from "next/server";
import { pollFeed } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 今すぐ新しい記事を確認する（フィードの読み取りのみ。本文の取得・要約は記事ごとに行う）
export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ added: await pollFeed(id) });
});
