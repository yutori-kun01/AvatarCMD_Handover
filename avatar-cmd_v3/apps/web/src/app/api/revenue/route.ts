import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { requireUser, handleApiError } from "@/lib/api-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    const where = {
      avatar: { userId: user.id },
      currency: "JPY",
      status: "confirmed",
    };
    const [summary, records] = await Promise.all([
      prisma.revenue.aggregate({ where, _sum: { amount: true } }),
      prisma.revenue.findMany({
        where,
        include: { avatar: { select: { name: true } } },
        orderBy: { earnedAt: "desc" },
        take: 100,
      }),
    ]);
    return NextResponse.json({
      totalRevenue: summary._sum.amount ?? 0,
      currency: "JPY",
      records,
    });
  } catch (e) {
    return handleApiError("売上の取得", e);
  }
}
