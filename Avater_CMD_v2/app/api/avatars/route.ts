import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/avatars - List all avatars with stats
export async function GET() {
  try {
    const avatars = await prisma.avatar.findMany({
      include: {
        platforms: true,
        _count: {
          select: {
            posts: true,
            revenue: true,
            knowledge: true,
            automations: true,
          },
        },
      },
      orderBy: { name: "asc" },
    })

    return NextResponse.json(avatars)
  } catch (error) {
    console.error("Failed to fetch avatars:", error)
    return NextResponse.json(
      { error: "アバターの取得に失敗しました" },
      { status: 500 }
    )
  }
}

// POST /api/avatars - Create a new avatar
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, role, specialization, targetAudience, tone, description, avatarImageUrl } = body

    if (!name || !role || !specialization || !targetAudience) {
      return NextResponse.json(
        { error: "name, role, specialization, targetAudience は必須です" },
        { status: 400 }
      )
    }

    const avatar = await prisma.avatar.create({
      data: {
        name,
        role,
        specialization,
        targetAudience,
        tone: tone || null,
        description: description || null,
        avatarImageUrl: avatarImageUrl || null,
      },
    })

    return NextResponse.json(avatar, { status: 201 })
  } catch (error) {
    console.error("Failed to create avatar:", error)
    return NextResponse.json(
      { error: "アバターの作成に失敗しました" },
      { status: 500 }
    )
  }
}
