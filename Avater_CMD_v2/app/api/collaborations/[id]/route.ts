import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/collaborations/[id]
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    const collab = await prisma.collaboration.findUnique({
      where: { id },
      include: {
        initiator: { select: { id: true, name: true, role: true } },
        partner: { select: { id: true, name: true, role: true } },
      },
    })

    if (!collab) {
      return NextResponse.json(
        { error: "コラボレーションが見つかりません" },
        { status: 404 }
      )
    }

    return NextResponse.json(collab)
  } catch (error) {
    console.error("Failed to fetch collaboration:", error)
    return NextResponse.json(
      { error: "コラボレーションの取得に失敗しました" },
      { status: 500 }
    )
  }
}

// PATCH /api/collaborations/[id]
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    const collab = await prisma.collaboration.update({
      where: { id },
      data: body,
      include: {
        initiator: { select: { id: true, name: true } },
        partner: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json(collab)
  } catch (error) {
    console.error("Failed to update collaboration:", error)
    return NextResponse.json(
      { error: "コラボレーションの更新に失敗しました" },
      { status: 500 }
    )
  }
}

// DELETE /api/collaborations/[id]
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    await prisma.collaboration.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete collaboration:", error)
    return NextResponse.json(
      { error: "コラボレーションの削除に失敗しました" },
      { status: 500 }
    )
  }
}
