import { NextResponse } from "next/server";
import { revokeApiKey } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 失効（即時。元に戻せない。必要なら新しいキーを発行する）
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await revokeApiKey(id);
  return NextResponse.json({ ok: true });
});
