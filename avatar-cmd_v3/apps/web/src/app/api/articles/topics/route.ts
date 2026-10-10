// note 記事のテーマ候補: 一覧（GET ?ruleId=）と、今すぐ提案（POST { ruleId }）
import { NextResponse } from "next/server";
import { listTopicSuggestions, suggestArticleTopics } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = route(async (req: Request) => {
  const ruleId = new URL(req.url).searchParams.get("ruleId") || undefined;
  return NextResponse.json({ suggestions: await listTopicSuggestions({ ruleId }) });
});

export const POST = route(async (req: Request) => {
  const { ruleId } = (await req.json()) as { ruleId?: string };
  if (!ruleId) return NextResponse.json({ error: "ルールを選んでください" }, { status: 400 });
  return NextResponse.json({ added: await suggestArticleTopics(ruleId) });
});
