// 見出しごとの画像・図解の計画を立て、本文に目印（<!-- image: … --> / <!-- infographic: … -->）を入れる
import { NextResponse } from "next/server";
import { insertVisualMarkers, planVisuals } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { markdown: string; maxVisuals?: number };
  const plan = await planVisuals({ markdown: b.markdown ?? "", maxVisuals: b.maxVisuals });
  return NextResponse.json({ plan, markdown: insertVisualMarkers(b.markdown, plan) });
});
