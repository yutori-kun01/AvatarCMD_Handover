// 参考画像からスタイル定義を作る（画像を読めるモデルを使う）
import { NextResponse } from "next/server";
import { analyzeStyle } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { kind: string };
  return NextResponse.json({ style: await analyzeStyle(id, b.kind) });
});
