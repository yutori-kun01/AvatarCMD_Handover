import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { validatePrice, type PriceInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.priceEntry.update({ where: { id }, data: validatePrice((await req.json()) as PriceInput) });
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.priceEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
