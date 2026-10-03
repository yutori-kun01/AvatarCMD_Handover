import { NextResponse } from "next/server";
import { revertKnowledge } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 指定した版に差し戻す（差し戻しも新しい版として履歴に残る）
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { version } = (await req.json()) as { version: number };
  return NextResponse.json({ item: await revertKnowledge(id, Number(version), "human") });
});
