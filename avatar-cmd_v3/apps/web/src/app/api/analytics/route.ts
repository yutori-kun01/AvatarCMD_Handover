import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { requireUser, handleApiError } from "@/lib/api-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    const scope = { avatar: { userId: user.id } };
    const [avatars, posts, revenue, rules] = await Promise.all([
      prisma.avatar.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          name: true,
          role: true,
          status: true,
          snsAccounts: {
            select: {
              followerCount: true,
              platform: true,
              accountName: true,
              lastSyncAt: true,
            },
          },
          _count: { select: { contents: true, knowledgeItems: true } },
        },
      }),
      prisma.content.groupBy({
        by: ["status"],
        where: scope,
        _count: { _all: true },
      }),
      prisma.revenue.aggregate({
        where: { ...scope, currency: "JPY", status: "confirmed" },
        _sum: { amount: true },
      }),
      prisma.automationRule.count({ where: { ...scope, isActive: true } }),
    ]);
    return NextResponse.json({
      avatars,
      posts: Object.fromEntries(posts.map((p) => [p.status, p._count._all])),
      confirmedRevenueJPY: revenue._sum.amount ?? 0,
      activeRules: rules,
    });
  } catch (e) {
    return handleApiError("集計", e);
  }
}
