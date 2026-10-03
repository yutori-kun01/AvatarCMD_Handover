import { NextResponse } from "next/server";
import { saveImprovementSchedule } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// { avatarId, mode?: "suggest" | "approve" | "auto", enabled?: boolean }。次回日時は変えない
export const PUT = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; mode?: string; enabled?: boolean };
  await saveImprovementSchedule(b.avatarId, { mode: b.mode, enabled: b.enabled });
  return NextResponse.json({ ok: true });
});
