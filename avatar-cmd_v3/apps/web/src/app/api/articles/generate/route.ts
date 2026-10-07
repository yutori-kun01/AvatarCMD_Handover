// note 記事の本文を AI で書く（その場で待つ版。画面からは /api/articles/jobs でバックグラウンドに依頼する）
// タイトルだけ・タイトル＋テーマ・テーマだけ・書きかけの本文のどれからでも書ける（入力済みの部分は活かす）
import { NextResponse } from "next/server";
import { generateNoteArticle, generateNoteDraft } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; topic?: string; title?: string; markdown?: string; paid?: boolean; preserve?: boolean; extraPrompt?: string };
  if (![b.title, b.topic, b.markdown].some((v) => v?.trim())) return NextResponse.json({ error: "タイトル・テーマ・本文のどれかを入力してください" }, { status: 400 });
  // 以前の呼び方（テーマだけ）は text に「# タイトル + 本文」を返す
  if (!b.title?.trim() && !b.markdown?.trim()) return NextResponse.json(await generateNoteArticle({ avatarId: b.avatarId, topic: b.topic!.trim(), paid: !!b.paid, extraPrompt: b.extraPrompt }));
  const d = await generateNoteDraft({ avatarId: b.avatarId, title: b.title, topic: b.topic, markdown: b.markdown, paid: !!b.paid, preserve: !!b.preserve, extraPrompt: b.extraPrompt });
  return NextResponse.json({ ...d, text: `# ${d.title}\n\n${d.markdown}` });
});
