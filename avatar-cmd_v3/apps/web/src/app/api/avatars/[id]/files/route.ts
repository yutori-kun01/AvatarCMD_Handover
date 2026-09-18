import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import {
  EDITABLE_AVATAR_FILES,
  InvalidAvatarPathError,
  listAvatarFiles,
  readAvatarFile,
  writeAvatarFile,
} from "@avatar-cmd/core";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** 指定アバターがログインユーザーのものか確認する */
async function assertOwnedAvatar(id: string, userId: string): Promise<boolean> {
  const avatar = await prisma.avatar.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  return avatar !== null;
}

// GET /api/avatars/[id]/files — Soul Engine のファイル取得
// ?filename= を付けると単一ファイル、省略すると全ファイル
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    if (!(await assertOwnedAvatar(id, user.id))) {
      return NextResponse.json({ error: "アバターが見つかりません" }, { status: 404 });
    }

    const filename = new URL(request.url).searchParams.get("filename");

    if (filename) {
      const content = await readAvatarFile(id, filename);
      if (content === null) {
        return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
      }
      return NextResponse.json({ filename, content });
    }

    return NextResponse.json(await listAvatarFiles(id));
  } catch (error) {
    if (error instanceof InvalidAvatarPathError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleApiError("ファイルの読み込み", error);
  }
}

// PUT /api/avatars/[id]/files — Soul Engine のファイル更新
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    if (!(await assertOwnedAvatar(id, user.id))) {
      return NextResponse.json({ error: "アバターが見つかりません" }, { status: 404 });
    }

    const { filename, content } = await request.json();

    if (typeof filename !== "string" || typeof content !== "string") {
      return NextResponse.json(
        {
          error: "filename と content は必須です",
          editableFiles: EDITABLE_AVATAR_FILES,
        },
        { status: 400 }
      );
    }

    await writeAvatarFile(id, filename, content);

    // ファイルとDBの最終同期日時を記録する
    await prisma.avatar.update({
      where: { id },
      data: { lastSyncAt: new Date() },
    });

    await prisma.activityLog.create({
      data: {
        avatarId: id,
        action: "soul_updated",
        category: "system",
        description: `${filename} を更新しました`,
        level: "info",
      },
    });

    return NextResponse.json({ success: true, filename });
  } catch (error) {
    if (error instanceof InvalidAvatarPathError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleApiError("ファイルの書き込み", error);
  }
}
