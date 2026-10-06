// 図解のプレビュー・作成: 設計図（spec）をそのまま描くか、説明から AI に設計させる
import { NextResponse } from "next/server";
import { renderVisual, type InfographicSpec } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; description: string; context?: string; spec?: Partial<InfographicSpec> };
  if (!b.avatarId) return NextResponse.json({ error: "アバターを選択してください" }, { status: 400 });
  return NextResponse.json(await renderVisual({ avatarId: b.avatarId, kind: "infographic", description: b.description || "図解", context: b.context, spec: b.spec }));
});
