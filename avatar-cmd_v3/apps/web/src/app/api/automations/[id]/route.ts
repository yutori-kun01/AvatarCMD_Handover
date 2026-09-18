import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/automations/[id] — 有効/無効の切り替えと基本項目の更新
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const owned = await prisma.automationRule.findFirst({
      where: { id, avatar: { userId: user.id } },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "自動化ルールが見つかりません" }, { status: 404 });
    }

    const body = await request.json();
    const data: Prisma.AutomationRuleUpdateInput = {};

    // v2 は status 文字列だったが、v3 は isActive (Boolean)
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if (typeof body.status === "string") data.isActive = body.status === "ACTIVE";
    if (typeof body.name === "string") data.name = body.name;
    if (typeof body.description === "string") data.description = body.description;
    if (typeof body.category === "string") data.category = body.category;
    if (typeof body.triggerType === "string") data.triggerType = body.triggerType;
    if (typeof body.actionType === "string") data.actionType = body.actionType;
    if (body.triggerConfig && typeof body.triggerConfig === "object") {
      data.triggerConfig = body.triggerConfig as Prisma.InputJsonValue;
    }
    if (body.actionConfig && typeof body.actionConfig === "object") {
      data.actionConfig = body.actionConfig as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "更新可能な項目がありません" }, { status: 400 });
    }

    const rule = await prisma.automationRule.update({ where: { id }, data });
    return NextResponse.json(rule);
  } catch (error) {
    return handleApiError("自動化ルールの更新", error);
  }
}

// DELETE /api/automations/[id]
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const result = await prisma.automationRule.deleteMany({
      where: { id, avatar: { userId: user.id } },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "自動化ルールが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError("自動化ルールの削除", error);
  }
}
