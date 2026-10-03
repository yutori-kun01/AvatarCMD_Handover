import { NextResponse } from "next/server";
import { getKnowledge, listRevisions, updateKnowledge, type KnowledgeInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const item = await getKnowledge(id);
  if (!item) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ item, revisions: await listRevisions(id) });
});

// 編集・無効化（status: "disabled"）。変更前の版は履歴に残る
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ item: await updateKnowledge(id, (await req.json()) as KnowledgeInput, "human") });
});
