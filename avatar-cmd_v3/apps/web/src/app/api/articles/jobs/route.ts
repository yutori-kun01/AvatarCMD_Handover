// note 記事の生成ジョブ: 依頼（POST）と最近の一覧（GET）。生成は worker がバックグラウンドで行い、画面を閉じても続く
import { NextResponse } from "next/server";
import { enqueueArticleJob, listArticleJobs, type ArticleJobKind } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const avatarId = new URL(req.url).searchParams.get("avatarId") ?? undefined;
  return NextResponse.json({ jobs: await listArticleJobs({ avatarId, limit: 20 }) });
});

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { kind: ArticleJobKind; avatarId: string; input: any };
  const input = b.input ?? {};
  if (b.kind === "write" && ![input.title, input.topic, input.markdown].some((v) => typeof v === "string" && v.trim()))
    return NextResponse.json({ error: "タイトル・テーマ・本文のどれかを入力してください" }, { status: 400 });
  if (b.kind === "eyecatch" && !input.title?.trim()) return NextResponse.json({ error: "タイトルを入力してください" }, { status: 400 });
  if (b.kind === "render" && !input.markdown?.trim()) return NextResponse.json({ error: "本文が空です" }, { status: 400 });
  if (b.kind === "full") {
    if (![input.title, input.topic].some((v) => typeof v === "string" && v.trim())) return NextResponse.json({ error: "テーマかタイトルを入力してください" }, { status: 400 });
    // ruleId は自動化ルールの実行だけが付ける（画面からの依頼では受け付けない）
    delete input.ruleId;
  }
  return NextResponse.json({ job: await enqueueArticleJob(b.kind, b.avatarId, input) });
});
