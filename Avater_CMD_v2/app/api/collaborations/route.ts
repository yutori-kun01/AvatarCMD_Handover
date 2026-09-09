import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/collaborations - List all collaborations
export async function GET() {
  try {
    const collaborations = await prisma.collaboration.findMany({
      include: {
        initiator: {
          select: { id: true, name: true, avatarImageUrl: true, role: true },
        },
        partner: {
          select: { id: true, name: true, avatarImageUrl: true, role: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    })

    return NextResponse.json(collaborations)
  } catch (error) {
    console.error("Failed to fetch collaborations:", error)
    return NextResponse.json(
      { error: "コラボレーションの取得に失敗しました" },
      { status: 500 }
    )
  }
}

// POST /api/collaborations - Create a new collaboration
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { initiatorId, partnerId, title, description, platform } = body

    if (!initiatorId || !partnerId || !title) {
      return NextResponse.json(
        { error: "initiatorId, partnerId, title は必須です" },
        { status: 400 }
      )
    }

    const collab = await prisma.collaboration.create({
      data: {
        initiatorId,
        partnerId,
        title,
        description: description || null,
        platform: platform || null,
        status: "PROPOSED",
      },
      include: {
        initiator: { select: { id: true, name: true } },
        partner: { select: { id: true, name: true } },
      },
    })

    await prisma.activity.create({
      data: {
        avatarId: initiatorId,
        type: "collab_created",
        title: `コラボ「${title}」を提案`,
        description: `${collab.initiator.name} → ${collab.partner.name}`,
      },
    })

    return NextResponse.json(collab, { status: 201 })
  } catch (error) {
    console.error("Failed to create collaboration:", error)
    return NextResponse.json(
      { error: "コラボレーションの作成に失敗しました" },
      { status: 500 }
    )
  }
}
