import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { requireUser, handleApiError } from "@/lib/api-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    const accounts = await prisma.snsAccount.findMany({
      where: { avatar: { userId: user.id } },
      select: {
        id: true,
        avatarId: true,
        platform: true,
        accountName: true,
        accountId: true,
        authType: true,
        isActive: true,
        tokenExpiry: true,
        lastSyncAt: true,
        lastError: true,
        avatar: { select: { name: true } },
      },
    });
    return NextResponse.json({
      role: user.role,
      accounts,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      encryptionConfigured: Boolean(process.env.ENCRYPTION_KEY),
      schedulerEnabled: process.env.SCHEDULER_ENABLED !== "false",
      timezone: "Asia/Tokyo",
    });
  } catch (e) {
    return handleApiError("設定の取得", e);
  }
}
