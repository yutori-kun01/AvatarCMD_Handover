// アクティビティログ（投稿・失敗・接続・自動化の記録）
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const level = q.get("level") || undefined;
  const category = q.get("category") || undefined;
  const avatarId = q.get("avatarId") || undefined;
  const logs = await prisma.activityLog.findMany({
    where: { ...(level ? { level } : {}), ...(category ? { category } : {}), ...(avatarId ? { avatarId } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(q.get("limit") || 200), 500),
    include: { avatar: { select: { name: true } } },
  });
  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      avatarName: l.avatar?.name ?? null,
      action: l.action,
      category: l.category,
      level: l.level,
      description: l.description,
      metadata: l.metadata,
      createdAt: l.createdAt,
    })),
  });
});
