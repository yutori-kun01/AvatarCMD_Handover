import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const avatarId = searchParams.get("avatarId");
    const category = searchParams.get("category");

    const where: any = {};
    if (avatarId) where.avatarId = avatarId;
    if (category) where.category = category;

    const items = await prisma.knowledgeItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        avatar: {
          select: { name: true, role: true }
        }
      }
    });

    const totalCount = await prisma.knowledgeItem.count({ where });

    // カテゴリごとの集計
    const categoryGroup = await prisma.knowledgeItem.groupBy({
      by: ["category"],
      where,
      _count: true
    });
    
    // UI側の期待に合わせてマッピング
    const categories = categoryGroup.map(g => ({
      category: g.category,
      _count: g._count
    }));

    // tagsをJSON配列にパースして返す
    const parsedItems = items.map(item => {
      let parsedTags: string[] = [];
      try {
        if (typeof item.tags === "string") {
          parsedTags = JSON.parse(item.tags);
        } else if (Array.isArray(item.tags)) {
          parsedTags = item.tags;
        }
      } catch (e) {
        parsedTags = [];
      }
      return { ...item, tags: parsedTags };
    });

    return NextResponse.json({
      items: parsedItems,
      totalCount,
      categories
    });
  } catch (error: any) {
    console.error("Error fetching knowledge:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, category, sourceUrl, content, avatarId, tags } = body;

    if (!title || !avatarId) {
      return NextResponse.json(
        { error: "title and avatarId are required" },
        { status: 400 }
      );
    }

    // JSON配列としてタグを文字列化（SQLiteのString実装に合わせる）
    const finalTags = Array.isArray(tags) ? JSON.stringify(tags) : "[]";

    // 1. レコードの作成（ステータスはPending）
    const item = await prisma.knowledgeItem.create({
      data: {
        title,
        category: category || "未分類",
        tags: finalTags as any,
        sourceUrl,
        content: content || "",
        avatarId,
      },
    });

    // 2. もし sourceUrl があって content が空の場合、Orchestrator に収集ジョブを投げる
    if (sourceUrl && !content) {
      const { orchestrator } = await import("@/lib/queue/orchestrator");
      await orchestrator.addJob("fetch_knowledge", {
        avatarId,
        data: { knowledgeId: item.id, url: sourceUrl }
      });
    }

    return NextResponse.json(item);
  } catch (error: any) {
    console.error("Error creating knowledge:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
