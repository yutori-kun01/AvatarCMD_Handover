// note 記事テンプレート: 一覧（GET）と保存（POST。id があれば更新）
import { NextResponse } from "next/server";
import { listArticleTemplates, saveArticleTemplate, type ArticleTemplateInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ templates: await listArticleTemplates() }));

export const POST = route(async (req: Request) => {
  const template = await saveArticleTemplate((await req.json()) as ArticleTemplateInput);
  return NextResponse.json({ ok: true, template });
});
