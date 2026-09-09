import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/revenue - Revenue summary with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const avatarId = searchParams.get("avatarId")

    const where: Record<string, unknown> = {}
    if (avatarId) where.avatarId = avatarId

    // Recent revenue entries
    const entries = await prisma.revenue.findMany({
      where,
      include: {
        avatar: {
          select: { id: true, name: true },
        },
      },
      orderBy: { earnedAt: "desc" },
      take: 50,
    })

    // Aggregate totals by avatar
    const totals = await prisma.revenue.groupBy({
      by: ["avatarId"],
      where,
      _sum: { amount: true },
      _count: true,
    })

    return NextResponse.json({ entries, totals })
  } catch (error) {
    console.error("Failed to fetch revenue:", error)
    return NextResponse.json(
      { error: "収益データの取得に失敗しました" },
      { status: 500 }
    )
  }
}

// POST /api/revenue - Record a revenue entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { avatarId, type, amount, description, platform } = body

    if (!avatarId || !type || amount === undefined) {
      return NextResponse.json(
        { error: "avatarId, type, amount は必須です" },
        { status: 400 }
      )
    }

    const entry = await prisma.revenue.create({
      data: {
        avatarId,
        type,
        amount,
        description: description || null,
        platform: platform || null,
      },
    })

    // Log activity
    await prisma.activity.create({
      data: {
        avatarId,
        type: "revenue_earned",
        title: `¥${amount.toLocaleString()} の収益を記録`,
        description: `${type}: ${description || ""}`,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    console.error("Failed to create revenue:", error)
    return NextResponse.json(
      { error: "収益の記録に失敗しました" },
      { status: 500 }
    )
  }
}
