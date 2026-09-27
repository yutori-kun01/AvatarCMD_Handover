import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { retryPost } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await prisma.content.findUniqueOrThrow({ where: { id } });
  if (c.status !== "FAILED") return NextResponse.json({ error: "失敗した投稿のみ再送できます" }, { status: 400 });
  await retryPost(id);
  return NextResponse.json({ ok: true });
});
