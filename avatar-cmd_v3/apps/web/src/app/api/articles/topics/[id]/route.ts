// note 記事のテーマ候補: 採用・却下・修正・先頭へ（PATCH { status?, topic?, toTop? }）
import { NextResponse } from "next/server";
import { updateTopicSuggestion } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ suggestion: await updateTopicSuggestion(id, (await req.json()) as { status?: string; topic?: string; toTop?: boolean }) });
});
