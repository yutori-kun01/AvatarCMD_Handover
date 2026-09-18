import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/avatars — ログインユーザーのアバター一覧
export async function GET() {
  try {
    const user = await requireUser();

    const avatars = await prisma.avatar.findMany({
      where: { userId: user.id },
      include: {
        snsAccounts: {
          select: {
            id: true,
            platform: true,
            accountName: true,
            profileUrl: true,
            authType: true,
          },
        },
        _count: {
          select: {
            contents: true,
            revenues: true,
            knowledgeItems: true,
            automationRules: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(avatars);
  } catch (error) {
    return handleApiError("アバターの取得", error);
  }
}

// POST /api/avatars — アバターを作成
export async function POST(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const body = await request.json();
    const { name, role, specialization, targetAudience, description, avatarImageUrl } = body;

    if (!name || !role) {
      return NextResponse.json(
        { error: "name, role は必須です" },
        { status: 400 }
      );
    }

    const data: Prisma.AvatarCreateInput = {
      user: { connect: { id: user.id } },
      name: String(name),
      role: String(role),
      specialization: specialization ? String(specialization) : null,
      targetAudience: targetAudience ? String(targetAudience) : null,
      description: description ? String(description) : null,
      avatarImageUrl: avatarImageUrl ? String(avatarImageUrl) : null,
    };

    const avatar = await prisma.avatar.create({ data });

    await prisma.activityLog.create({
      data: {
        avatarId: avatar.id,
        action: "avatar_created",
        category: "system",
        description: `アバター「${avatar.name}」が作成されました`,
        level: "success",
      },
    });

    return NextResponse.json(avatar, { status: 201 });
  } catch (error) {
    return handleApiError("アバターの作成", error);
  }
}
