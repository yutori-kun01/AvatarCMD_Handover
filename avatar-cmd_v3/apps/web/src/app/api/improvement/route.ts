// 改善処理（14〜27日ごと）の予定とサイクル一覧
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { ensureSchedules, IMPROVEMENT_MODE_LABEL, IMPROVEMENT_RULES, listImprovementCycles } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const avatarId = new URL(req.url).searchParams.get("avatarId") ?? undefined;
  await ensureSchedules();
  const [schedules, cycles] = await Promise.all([
    prisma.improvementSchedule.findMany({ where: avatarId ? { avatarId } : {} }),
    listImprovementCycles(avatarId ? { avatarId } : {}, 20),
  ]);
  return NextResponse.json({ schedules, cycles, modes: IMPROVEMENT_MODE_LABEL, rules: IMPROVEMENT_RULES });
});
