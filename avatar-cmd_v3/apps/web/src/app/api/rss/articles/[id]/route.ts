import { NextResponse } from "next/server";
import { fetchArticleContent, markArticleUnavailable, submitArticleContent, summarizeArticle } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 記事ごとの操作:
//   { action: "fetch" }   … 記事ページから本文を取り出して要約
//   { action: "content", content } … 本文を登録して要約
//   { action: "summarize" } … 本文がある記事を（再）要約
//   { action: "unavailable", reason? } … 取得不可にする
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { action: string; content?: string; reason?: string };
  if (b.action === "fetch") {
    if (await fetchArticleContent(id)) await summarizeArticle(id);
  } else if (b.action === "content") {
    await submitArticleContent(id, b.content ?? "");
    await summarizeArticle(id);
  } else if (b.action === "summarize") {
    await summarizeArticle(id);
  } else if (b.action === "unavailable") {
    await markArticleUnavailable(id, b.reason ?? "取得不可");
  } else {
    return NextResponse.json({ error: "action が不正です" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
