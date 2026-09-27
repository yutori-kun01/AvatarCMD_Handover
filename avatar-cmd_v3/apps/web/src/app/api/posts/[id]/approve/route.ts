// 下書き（自動化で生成されたもの等）を承認して投稿キューへ
import { NextResponse } from "next/server";
import { approveDraft } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { text?: string; scheduledAt?: string };
  const at = b.scheduledAt ? new Date(b.scheduledAt) : undefined;
  if (at && Number.isNaN(at.getTime())) return NextResponse.json({ error: "予約日時が不正です" }, { status: 400 });
  await approveDraft(id, b.text, at);
  return NextResponse.json({ ok: true });
});
