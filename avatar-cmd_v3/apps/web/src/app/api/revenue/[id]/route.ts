import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.revenue.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
