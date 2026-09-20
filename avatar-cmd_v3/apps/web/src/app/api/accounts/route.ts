import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { CredentialVault } from "@avatar-cmd/core";
import { requireWriteUser, handleApiError } from "@/lib/api-auth";
export async function POST(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const body = await request.json();
    if (
      typeof body.avatarId !== "string" ||
      !["x", "threads"].includes(body.platform) ||
      typeof body.accountName !== "string" ||
      !body.accountName.trim()
    )
      return NextResponse.json(
        { error: "アバター・SNS・アカウント名を指定してください" },
        { status: 400 },
      );
    if (
      typeof body.accessToken !== "string" ||
      !body.accessToken.trim() ||
      body.accessToken.length > 8192 ||
      (body.refreshToken &&
        (typeof body.refreshToken !== "string" ||
          body.refreshToken.length > 8192))
    )
      return NextResponse.json(
        { error: "有効なトークンを入力してください" },
        { status: 400 },
      );
    const owned = await prisma.avatar.findFirst({
      where: { id: body.avatarId, userId: user.id },
      select: { id: true },
    });
    if (!owned)
      return NextResponse.json(
        { error: "アバターが見つかりません" },
        { status: 404 },
      );
    const expiry = body.tokenExpiry ? new Date(body.tokenExpiry) : null;
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date()))
      return NextResponse.json(
        { error: "有効期限を確認してください" },
        { status: 400 },
      );
    const vault = new CredentialVault();
    await prisma.$transaction(async (tx) => {
      // Serialize changes for an avatar so only one active destination remains.
      await tx.avatar.update({
        where: { id: owned.id },
        data: { updatedAt: new Date() },
      });
      await tx.snsAccount.updateMany({
        where: { avatarId: owned.id, platform: body.platform },
        data: { isActive: false },
      });
      const data = {
        accessToken: vault.encrypt(body.accessToken.trim()),
        refreshToken: body.refreshToken
          ? vault.encrypt(body.refreshToken.trim())
          : null,
        accountId: typeof body.accountId === "string" ? body.accountId : null,
        tokenExpiry: expiry,
        authType: "oauth",
        isActive: true,
        lastError: null,
      };
      await tx.snsAccount.upsert({
        where: {
          avatarId_platform_accountName: {
            avatarId: owned.id,
            platform: body.platform,
            accountName: body.accountName.trim(),
          },
        },
        create: {
          avatarId: owned.id,
          platform: body.platform,
          accountName: body.accountName.trim(),
          ...data,
        },
        update: data,
      });
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleApiError("接続情報の保存", e);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const { id } = await request.json();
    if (typeof id !== "string")
      return NextResponse.json(
        { error: "接続を指定してください" },
        { status: 400 },
      );
    const result = await prisma.snsAccount.updateMany({
      where: { id, avatar: { userId: user.id } },
      data: {
        isActive: false,
        accessToken: null,
        refreshToken: null,
        tokenExpiry: null,
      },
    });
    return result.count
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: "接続が見つかりません" }, { status: 404 });
  } catch (e) {
    return handleApiError("接続解除", e);
  }
}
