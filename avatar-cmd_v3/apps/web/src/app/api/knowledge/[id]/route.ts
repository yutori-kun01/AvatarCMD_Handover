import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { handleApiError, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/knowledge/[id]
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const result = await prisma.knowledgeItem.deleteMany({
      where: { id, avatar: { userId: user.id } },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "ナレッジが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError("ナレッジの削除", error);
  }
}
