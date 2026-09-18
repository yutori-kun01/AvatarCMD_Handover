import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { orchestrator } from "@avatar-cmd/core";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** tags は Json 列。配列以外が入っていても UI 側が壊れないよう正規化する */
function normalizeTags(tags: Prisma.JsonValue): string[] {
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === "string");
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

// GET /api/knowledge — ナレッジ一覧（avatarId / category で絞り込み可）
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);

    const where: Prisma.KnowledgeItemWhereInput = {
      // 自分のアバターに属するものだけを返す
      avatar: { userId: user.id },
    };
    const avatarId = searchParams.get("avatarId");
    const category = searchParams.get("category");
    if (avatarId) where.avatarId = avatarId;
    if (category) where.category = category;

    const [items, totalCount, categoryGroup] = await Promise.all([
      prisma.knowledgeItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { avatar: { select: { id: true, name: true, role: true } } },
      }),
      prisma.knowledgeItem.count({ where }),
      prisma.knowledgeItem.groupBy({
        by: ["category"],
        where,
        _count: { _all: true },
      }),
    ]);

    return NextResponse.json({
      items: items.map((item) => ({ ...item, tags: normalizeTags(item.tags) })),
      totalCount,
      categories: categoryGroup.map((g) => ({
        category: g.category,
        _count: g._count._all,
      })),
    });
  } catch (error) {
    return handleApiError("ナレッジの取得", error);
  }
}

// POST /api/knowledge — ナレッジを登録。sourceUrl のみの場合は収集ジョブを投入
export async function POST(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const body = await request.json();
    const { title, category, sourceUrl, content, avatarId, tags } = body;

    if (!title || !avatarId) {
      return NextResponse.json(
        { error: "title, avatarId は必須です" },
        { status: 400 }
      );
    }

    const owned = await prisma.avatar.findFirst({
      where: { id: String(avatarId), userId: user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "アバターが見つかりません" }, { status: 404 });
    }

    const item = await prisma.knowledgeItem.create({
      data: {
        avatarId: owned.id,
        title: String(title),
        // v3 の source は必須。URL 由来か手入力かを区別する
        source: sourceUrl ? "url" : "manual",
        sourceUrl: sourceUrl ? String(sourceUrl) : null,
        content: content ? String(content) : null,
        category: category ? String(category) : "general",
        // PostgreSQL の Json 列なので配列をそのまま渡す（v2 は SQLite 向けに
        // JSON.stringify していた）
        tags: Array.isArray(tags)
          ? (tags.filter((t) => typeof t === "string") as Prisma.InputJsonValue)
          : [],
      },
    });

    // URL だけ渡された場合は本文をバックグラウンドで収集する
    // （収集時の fetch は core の SSRF ガードを通る）
    if (sourceUrl && !content) {
      await orchestrator.addJob("fetch_knowledge", {
        avatarId: owned.id,
        data: { knowledgeId: item.id, url: String(sourceUrl) },
      });
    }

    return NextResponse.json({ ...item, tags: normalizeTags(item.tags) }, { status: 201 });
  } catch (error) {
    return handleApiError("ナレッジの作成", error);
  }
}
