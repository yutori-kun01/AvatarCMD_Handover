import { NextResponse } from "next/server";
import { runImprovementNow } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 手動実行（定期の日程は変えない）
export const POST = route(async (req: Request) => {
  const { avatarId } = (await req.json()) as { avatarId: string };
  return NextResponse.json({ cycle: await runImprovementNow(avatarId) });
});
