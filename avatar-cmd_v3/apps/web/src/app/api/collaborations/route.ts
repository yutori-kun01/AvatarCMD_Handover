import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const AVATAR_SUMMARY = {
  select: { id: true, name: true, role: true, avatarImageUrl: true },
} as const;

// GET /api/collaborations — 自分のアバターが関わるコラボ一覧
export async function GET() {
  try {
    const user = await requireUser();

    const collaborations = await prisma.collaboration.findMany({
      where: {
        OR: [
          { initiator: { userId: user.id } },
          { partner: { userId: user.id } },
        ],
      },
      include: { initiator: AVATAR_SUMMARY, partner: AVATAR_SUMMARY },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(collaborations);
  } catch (error) {
    return handleApiError("コラボレーションの取得", error);
  }
}

// POST /api/collaborations
export async function POST(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const body = await request.json();
    const { initiatorId, partnerId, title, description, platform } = body;

    if (!initiatorId || !partnerId || !title) {
      return NextResponse.json(
        { error: "initiatorId, partnerId, title は必須です" },
        { status: 400 }
      );
    }
    if (initiatorId === partnerId) {
      return NextResponse.json(
        { error: "同じアバター同士のコラボは作成できません" },
        { status: 400 }
      );
    }

    // 発起側は自分のアバターに限定する
    const initiator = await prisma.avatar.findFirst({
      where: { id: String(initiatorId), userId: user.id },
      select: { id: true, name: true },
    });
    if (!initiator) {
      return NextResponse.json(
        { error: "発起アバターが見つかりません" },
        { status: 404 }
      );
    }

    const partner = await prisma.avatar.findUnique({
      where: { id: String(partnerId) },
      select: { id: true, name: true },
    });
    if (!partner) {
      return NextResponse.json(
        { error: "相手アバターが見つかりません" },
        { status: 404 }
      );
    }

    const collab = await prisma.collaboration.create({
      data: {
        initiatorId: initiator.id,
        partnerId: partner.id,
        title: String(title),
        description: description ? String(description) : null,
        platform: platform ? String(platform) : null,
        status: "PROPOSED",
      },
      include: { initiator: AVATAR_SUMMARY, partner: AVATAR_SUMMARY },
    });

    await prisma.activityLog.create({
      data: {
        avatarId: initiator.id,
        action: "collab_created",
        category: "content",
        description: `コラボ「${collab.title}」を提案: ${initiator.name} → ${partner.name}`,
        level: "info",
      },
    });

    return NextResponse.json(collab, { status: 201 });
  } catch (error) {
    return handleApiError("コラボレーションの作成", error);
  }
}
