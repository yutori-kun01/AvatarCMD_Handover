// 動画パイプライン: エピソードの一覧（GET）と作成（POST）。作成するとネタ候補（広告は台本）の生成が始まる
import { NextResponse } from "next/server";
import { createEpisode, listEpisodes } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const avatarId = new URL(req.url).searchParams.get("avatarId") ?? undefined;
  return NextResponse.json({ episodes: await listEpisodes({ avatarId }) });
});

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; profile?: string; targets?: string[]; theme?: string; key?: string; targetMinutes?: number };
  return NextResponse.json({ episode: await createEpisode(b) });
});
