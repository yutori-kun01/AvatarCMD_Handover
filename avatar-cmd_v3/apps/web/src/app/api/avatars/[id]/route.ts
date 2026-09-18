import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH で更新を許可するフィールド。body をそのまま渡すと userId 等も
 *  書き換えられてしまうため、ホワイトリストで絞る。 */
function pickUpdatableFields(body: Record<string, unknown>): Prisma.AvatarUpdateInput {
  const data: Prisma.AvatarUpdateInput = {};

  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.role === "string") data.role = body.role;
  if (typeof body.description === "string") data.description = body.description;
  if (typeof body.specialization === "string") data.specialization = body.specialization;
  if (typeof body.targetAudience === "string") data.targetAudience = body.targetAudience;
  if (typeof body.avatarImageUrl === "string") data.avatarImageUrl = body.avatarImageUrl;
  if (typeof body.status === "string") {
    data.status = body.status as Prisma.AvatarUpdateInput["status"];
  }
  if (body.personality && typeof body.personality === "object") {
    data.personality = body.personality as Prisma.InputJsonValue;
  }
  if (body.communication && typeof body.communication === "object") {
    data.communication = body.communication as Prisma.InputJsonValue;
  }
  if (body.writingRules && typeof body.writingRules === "object") {
    data.writingRules = body.writingRules as Prisma.InputJsonValue;
  }

  return data;
}

// GET /api/avatars/[id]
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const avatar = await prisma.avatar.findFirst({
      where: { id, userId: user.id },
      include: {
        snsAccounts: true,
        contents: { orderBy: { createdAt: "desc" }, take: 20 },
        revenues: { orderBy: { earnedAt: "desc" }, take: 20 },
        knowledgeItems: { orderBy: { createdAt: "desc" }, take: 10 },
        automationRules: true,
        activityLogs: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    if (!avatar) {
      return NextResponse.json({ error: "アバターが見つかりません" }, { status: 404 });
    }

    return NextResponse.json(avatar);
  } catch (error) {
    return handleApiError("アバターの取得", error);
  }
}

// PATCH /api/avatars/[id]
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    // 他ユーザーのアバターを更新できないよう先に所有を確認する
    const owned = await prisma.avatar.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "アバターが見つかりません" }, { status: 404 });
    }

    const data = pickUpdatableFields(await request.json());
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "更新可能な項目がありません" }, { status: 400 });
    }

    const avatar = await prisma.avatar.update({ where: { id }, data });
    return NextResponse.json(avatar);
  } catch (error) {
    return handleApiError("アバターの更新", error);
  }
}

// DELETE /api/avatars/[id]
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const result = await prisma.avatar.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: "アバターが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError("アバターの削除", error);
  }
}
