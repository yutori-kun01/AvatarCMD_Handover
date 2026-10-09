// 動画パイプラインの固定アセット（アバター = チャンネルごと）: キャラ設定書・画風ガイド・声・読み辞書・ブランド
// 人が画面で保存したときだけ変わる。「確定」すると台本の承認（B）以降に進めるようになる
import { NextResponse } from "next/server";
import { getVideoAssets, saveVideoAssets } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const avatarId = new URL(req.url).searchParams.get("avatarId");
  if (!avatarId) return NextResponse.json({ error: "avatarId を指定してください" }, { status: 400 });
  return NextResponse.json({ assets: await getVideoAssets(avatarId) });
});

export const PUT = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string } & Parameters<typeof saveVideoAssets>[1];
  return NextResponse.json({ assets: await saveVideoAssets(b.avatarId, b) });
});
