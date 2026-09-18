import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const AVATAR_SUMMARY = {
  select: { id: true, name: true, role: true, avatarImageUrl: true },
} as const;

const ALLOWED_STATUSES = ["PROPOSED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

/** 自分のアバターが関与しているコラボのみ対象にする条件 */
function ownedBy(userId: string): Prisma.CollaborationWhereInput {
  return {
    OR: [{ initiator: { userId } }, { partner: { userId } }],
  };
}

// GET /api/collaborations/[id]
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const collab = await prisma.collaboration.findFirst({
      where: { id, ...ownedBy(user.id) },
      include: { initiator: AVATAR_SUMMARY, partner: AVATAR_SUMMARY },
    });

    if (!collab) {
      return NextResponse.json(
        { error: "コラボレーションが見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json(collab);
  } catch (error) {
    return handleApiError("コラボレーションの取得", error);
  }
}

// PATCH /api/collaborations/[id]
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const owned = await prisma.collaboration.findFirst({
      where: { id, ...ownedBy(user.id) },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "コラボレーションが見つかりません" },
        { status: 404 }
      );
    }

    // initiatorId / partnerId の差し替えは許可しない
    const body = await request.json();
    const data: Prisma.CollaborationUpdateInput = {};
    if (typeof body.title === "string") data.title = body.title;
    if (typeof body.description === "string") data.description = body.description;
    if (typeof body.platform === "string") data.platform = body.platform;
    if (typeof body.status === "string") {
      if (!ALLOWED_STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: `status は ${ALLOWED_STATUSES.join(" / ")} のいずれかです` },
          { status: 400 }
        );
      }
      data.status = body.status;
    }
    if (typeof body.startDate === "string") data.startDate = new Date(body.startDate);
    if (typeof body.endDate === "string") data.endDate = new Date(body.endDate);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "更新可能な項目がありません" }, { status: 400 });
    }

    const collab = await prisma.collaboration.update({
      where: { id },
      data,
      include: { initiator: AVATAR_SUMMARY, partner: AVATAR_SUMMARY },
    });

    return NextResponse.json(collab);
  } catch (error) {
    return handleApiError("コラボレーションの更新", error);
  }
}

// DELETE /api/collaborations/[id]
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const result = await prisma.collaboration.deleteMany({
      where: { id, ...ownedBy(user.id) },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "コラボレーションが見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError("コラボレーションの削除", error);
  }
}
