// ================================================
// /api/activity — アクティビティフィード (v3 では ActivityLog)
// ================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;

// GET /api/activity — avatarId / category / level で絞り込み可
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);

    // avatarId が null のシステムログも含めるため、自分のアバターに
    // 紐づくものと未紐づけのものを両方拾う
    const where: Prisma.ActivityLogWhereInput = {
      avatar: { userId: user.id },
    };
    const avatarId = searchParams.get("avatarId");
    const category = searchParams.get("category");
    const level = searchParams.get("level");
    if (avatarId) {
      where.OR = undefined;
      where.avatarId = avatarId;
      where.avatar = { userId: user.id };
    }
    if (category) where.category = category;
    if (level) where.level = level;

    const parsedLimit = Number(searchParams.get("limit") ?? 50);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), MAX_LIMIT)
        : 50;

    const activities = await prisma.activityLog.findMany({
      where,
      include: {
        avatar: { select: { id: true, name: true, avatarImageUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json(activities);
  } catch (error) {
    return handleApiError("アクティビティの取得", error);
  }
}
