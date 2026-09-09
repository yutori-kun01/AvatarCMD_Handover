import { NextResponse } from "next/server";
import { listAvatarFiles, readAvatarFile, writeAvatarFile } from "@/lib/avatar-fs/parser";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const avatar = await prisma.avatar.findUnique({
      where: { id: params.id },
    });

    if (!avatar) {
      return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const filename = searchParams.get("filename");

    if (filename) {
      // 特定のファイルを取得
      const content = await readAvatarFile(params.id, filename);
      if (content === null) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      return NextResponse.json({ filename, content });
    } else {
      // 全ファイルを取得
      const files = await listAvatarFiles(params.id);
      return NextResponse.json(files);
    }
  } catch (error: any) {
    console.error("Error reading avatar files:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const avatar = await prisma.avatar.findUnique({
      where: { id: params.id },
    });

    if (!avatar) {
      return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
    }

    const body = await request.json();
    const { filename, content } = body;

    if (!filename || content === undefined) {
      return NextResponse.json(
        { error: "filename and content are required" },
        { status: 400 }
      );
    }

    // ファイル書き込み
    await writeAvatarFile(params.id, filename, content);

    // 更新日時をアバター側にも反映（任意）
    await prisma.avatar.update({
      where: { id: params.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, filename });
  } catch (error: any) {
    console.error("Error writing avatar file:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
