// アバターの画像スタイル: 参考画像の一覧・追加、スタイル定義の取得・保存
import { NextResponse } from "next/server";
import { addStyleReference, getAvatarStyles, listStyleReferences, saveAvatarStyle } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const [references, styles] = await Promise.all([listStyleReferences(id), getAvatarStyles(id)]);
  return NextResponse.json({ references, styles });
});

/** 参考画像を追加（先に /api/media でアップロードした mediaName） */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { kind: string; mediaName: string; note?: string };
  return NextResponse.json({ reference: await addStyleReference({ avatarId: id, kind: b.kind, mediaName: b.mediaName, note: b.note }) });
});

/** デザイン DNA を手で直す（イメージ画像・図解で共通） */
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { style: Record<string, unknown> };
  return NextResponse.json({ style: await saveAvatarStyle(id, null, b.style as never) });
});
