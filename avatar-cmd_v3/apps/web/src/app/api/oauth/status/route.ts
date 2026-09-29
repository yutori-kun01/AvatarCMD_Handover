// 別ブラウザでの接続の進み具合（元の画面がポーリングする）
import { NextResponse } from "next/server";
import { getOAuthLinkStatus } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const GET = route(async (req: Request) => {
  const state = new URL(req.url).searchParams.get("state") ?? "";
  return NextResponse.json(await getOAuthLinkStatus(state));
});
