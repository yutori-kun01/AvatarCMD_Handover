import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireWriteUser } from "@/lib/api-auth";

import { automationInput } from "@/lib/automation-input";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/automations/[id] — 有効/無効の切り替えと基本項目の更新
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const owned = await prisma.automationRule.findFirst({
      where: { id, avatar: { userId: user.id } },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "自動化ルールが見つかりません" },
        { status: 404 },
      );
    }

    const body = await request.json();
    if (body.isActive === false && Object.keys(body).length === 1) {
      return NextResponse.json(
        await prisma.automationRule.update({
          where: { id },
          data: { isActive: false },
        }),
      );
    }
    let validated;
    try {
      validated = await automationInput(user.id, owned.avatarId, {
        ...owned,
        ...body,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "設定が不正です" },
        { status: 400 },
      );
    }
    const data: Prisma.AutomationRuleUpdateInput = {
      ...validated,
      actionConfig: validated.actionConfig as Prisma.InputJsonValue,
      ...(typeof body.isActive === "boolean"
        ? { isActive: body.isActive }
        : {}),
    };

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
      return NextResponse.json(
        { error: "自動化ルールが見つかりません" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError("自動化ルールの削除", error);
  }
}
