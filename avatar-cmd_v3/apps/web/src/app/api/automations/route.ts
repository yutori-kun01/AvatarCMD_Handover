import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

import { automationInput } from "@/lib/automation-input";

export const dynamic = "force-dynamic";

// GET /api/automations — 自動化ルール一覧（avatarId で絞り込み可）
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const avatarId = new URL(request.url).searchParams.get("avatarId");

    const where: Prisma.AutomationRuleWhereInput = {
      avatar: { userId: user.id },
    };
    if (avatarId) where.avatarId = avatarId;

    const rules = await prisma.automationRule.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { avatar: { select: { id: true, name: true } } },
    });

    return NextResponse.json(rules);
  } catch (error) {
    return handleApiError("自動化ルールの取得", error);
  }
}

// POST /api/automations
export async function POST(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const body = await request.json();
    // v2 は trigger / action / config の3項目だったが、v3 は
    // triggerType + triggerConfig / actionType + actionConfig に分かれる
    const {
      name,
      description,
      avatarId,
      category,
      triggerType,
      triggerConfig,
      actionType,
      actionConfig,
    } = body;

    if (!name || !avatarId || !triggerType || !actionType) {
      return NextResponse.json(
        { error: "name, avatarId, triggerType, actionType は必須です" },
        { status: 400 },
      );
    }

    const owned = await prisma.avatar.findFirst({
      where: { id: String(avatarId), userId: user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "アバターが見つかりません" },
        { status: 404 },
      );
    }

    let validated;
    try {
      validated = await automationInput(user.id, owned.id, body);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "設定が不正です" },
        { status: 400 },
      );
    }
    const rule = await prisma.automationRule.create({
      data: {
        avatarId: owned.id,
        ...validated,
        actionConfig: validated.actionConfig as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return handleApiError("自動化ルールの作成", error);
  }
}
