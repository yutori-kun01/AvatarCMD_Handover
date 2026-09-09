import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/activity - Get activity feed
export async function GET() {
  try {
    const activities = await prisma.activity.findMany({
      include: {
        avatar: {
          select: { id: true, name: true, avatarImageUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    return NextResponse.json(activities)
  } catch (error) {
    console.error("Failed to fetch activities:", error)
    return NextResponse.json(
      { error: "アクティビティの取得に失敗しました" },
      { status: 500 }
    )
  }
}
