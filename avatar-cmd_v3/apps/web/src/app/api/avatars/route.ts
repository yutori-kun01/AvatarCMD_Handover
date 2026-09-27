import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { ensureDefaultAvatar } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await ensureDefaultAvatar();
  const avatars = await prisma.avatar.findMany({ select: { id: true, name: true, role: true, status: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ avatars });
});

export const POST = route(async (req: Request) => {
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
  await ensureDefaultAvatar();
  const owner = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const avatar = await prisma.avatar.create({ data: { userId: owner.id, name: name.trim() } });
  return NextResponse.json({ avatar });
});
