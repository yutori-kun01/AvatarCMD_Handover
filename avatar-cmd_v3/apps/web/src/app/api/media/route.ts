// 投稿用メディアのアップロード（multipart/form-data, field: file）
import { NextResponse } from "next/server";
import { ALLOWED_MEDIA, saveMedia } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 512) * 1024 * 1024;

export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file がありません" }, { status: 400 });
  if (!ALLOWED_MEDIA[file.type]) return NextResponse.json({ error: `対応していない形式です: ${file.type || "不明"}` }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `ファイルが大きすぎます（上限 ${MAX_BYTES / 1024 / 1024}MB）` }, { status: 400 });
  const ref = await saveMedia(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
  const alt = form.get("alt");
  return NextResponse.json({ media: { ...ref, ...(typeof alt === "string" && alt ? { alt } : {}) } });
});
