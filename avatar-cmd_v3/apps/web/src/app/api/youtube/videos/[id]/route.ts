import { NextResponse } from "next/server";
import { fetchOwnCaptions, markUnavailable, submitTranscript, summarizeVideo } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 動画ごとの操作:
//   { action: "transcript", transcript } … 提供された文字起こしを登録して要約
//   { action: "captions" }   … 自分のチャンネル: 公式 Captions API で字幕を取得して要約
//   { action: "summarize" }  … 本文がある動画を（再）要約
//   { action: "unavailable", reason? } … 取得不可にする
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { action: string; transcript?: string; reason?: string };
  if (b.action === "transcript") {
    await submitTranscript(id, b.transcript ?? "");
    await summarizeVideo(id);
  } else if (b.action === "captions") {
    if (await fetchOwnCaptions(id)) await summarizeVideo(id);
  } else if (b.action === "summarize") {
    await summarizeVideo(id);
  } else if (b.action === "unavailable") {
    await markUnavailable(id, b.reason ?? "取得不可");
  } else {
    return NextResponse.json({ error: "action が不正です" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
