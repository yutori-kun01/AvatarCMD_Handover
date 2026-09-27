// 自動化ルールの「改善か継続か」を今すぐ判定する
import { NextResponse } from "next/server";
import { evaluateRulePerformance } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json(await evaluateRulePerformance(id));
});
