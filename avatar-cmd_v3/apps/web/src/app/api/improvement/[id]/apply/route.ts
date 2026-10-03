import { NextResponse } from "next/server";
import { applyImprovementChange } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 改善案を1件適用（「承認後に適用」モードのサイクル。二重には適用されない）
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { changeId } = (await req.json()) as { changeId: string };
  return NextResponse.json(await applyImprovementChange(id, changeId, "human"));
});
