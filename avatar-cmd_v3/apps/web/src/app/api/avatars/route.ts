import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { ensureDefaultAvatar, readPersona } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";
import { avatarData } from "@/lib/avatar-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await ensureDefaultAvatar();
  const avatars = await prisma.avatar.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      snsAccounts: { select: { id: true, platform: true, accountName: true, isActive: true, lastError: true } },
      _count: { select: { contents: true, automationRules: true } },
    },
  });
  const published = await prisma.content.groupBy({ by: ["avatarId"], where: { status: "PUBLISHED" }, _count: { _all: true } });
  const pub = new Map(published.map((p) => [p.avatarId, p._count._all]));
  return NextResponse.json({
    avatars: avatars.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      description: a.description,
      specialization: a.specialization,
      targetAudience: a.targetAudience,
      persona: readPersona(a.communication),
      accounts: a.snsAccounts,
      contentCount: a._count.contents,
      publishedCount: pub.get(a.id) ?? 0,
      ruleCount: a._count.automationRules,
      createdAt: a.createdAt,
    })),
  });
});

export const POST = route(async (req: Request) => {
  const body = await req.json();
  await ensureDefaultAvatar();
  const owner = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const avatar = await prisma.avatar.create({ data: { userId: owner.id, ...avatarData(body, true) } as any });
  return NextResponse.json({ avatar: { id: avatar.id, name: avatar.name } });
});
