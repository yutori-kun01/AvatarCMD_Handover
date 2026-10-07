// note 記事の生成ジョブの状態と結果（画面が数秒ごとに見に来る）
import { NextResponse } from "next/server";
import { getArticleJob } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const job = await getArticleJob((await params).id);
  if (!job) return NextResponse.json({ error: "ジョブが見つかりません（7 日より前のものは消えます）" }, { status: 404 });
  return NextResponse.json({ job });
});
