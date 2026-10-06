// 参考画像のメモ・有効/無効の変更と削除
import { NextResponse } from "next/server";
import { removeStyleReference, updateStyleReference } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ reference: await updateStyleReference(id, await req.json()) });
});

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await removeStyleReference(id);
  return NextResponse.json({ ok: true });
});
