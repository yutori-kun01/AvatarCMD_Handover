// アバター別ナレッジの一覧・追加
import { NextResponse } from "next/server";
import { createKnowledge, listKnowledge, searchKnowledge, type KnowledgeInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const avatarId = q.get("avatarId") ?? undefined;
  // q を付けると、投稿テーマに関連するナレッジ（生成で実際に使われるもの）を確認できる
  if (avatarId && q.get("q")) {
    const found = await searchKnowledge({ avatarId, query: q.get("q")!, platform: q.get("platform") ?? undefined, limit: 8 });
    return NextResponse.json({ items: found.map((f) => ({ ...f.item, score: f.score })) });
  }
  return NextResponse.json({ items: await listKnowledge({ avatarId, kind: q.get("kind") ?? undefined, status: q.get("status") ?? undefined, take: 300 }) });
});

export const POST = route(async (req: Request) => {
  const item = await createKnowledge((await req.json()) as KnowledgeInput, "human");
  return NextResponse.json({ item });
});
