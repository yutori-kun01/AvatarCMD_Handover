import { NextResponse } from "next/server";
import { dismissImprovementCycle } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await dismissImprovementCycle(id);
  return NextResponse.json({ ok: true });
});
