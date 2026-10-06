// 本文中の目印を画像・図解にして ![説明](media:…) に置き換える（only で番号を指定すると一部だけ）
import { NextResponse } from "next/server";
import { renderVisualMarkers } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 600;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; markdown: string; only?: number[] };
  if (!b.avatarId) return NextResponse.json({ error: "アバターを選択してください" }, { status: 400 });
  return NextResponse.json(await renderVisualMarkers({ avatarId: b.avatarId, markdown: b.markdown ?? "", only: b.only }));
});
