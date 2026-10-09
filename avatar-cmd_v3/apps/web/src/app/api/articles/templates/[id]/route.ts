// note 記事テンプレートの削除
import { NextResponse } from "next/server";
import { deleteArticleTemplate } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await deleteArticleTemplate((await params).id);
  return NextResponse.json({ ok: true });
});
