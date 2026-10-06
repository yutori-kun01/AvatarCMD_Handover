// 参考画像（イメージ画像用・図解用の両方）からデザイン DNA を作る（画像を読めるモデルを使う）
import { NextResponse } from "next/server";
import { analyzeStyle } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await req.json().catch(() => ({}));
  return NextResponse.json({ style: await analyzeStyle(id) });
});
