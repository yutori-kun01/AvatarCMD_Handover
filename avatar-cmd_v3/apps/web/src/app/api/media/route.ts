// 投稿用メディアのアップロード（multipart/form-data, field: file）
import { NextResponse } from "next/server";
import { ALLOWED_MEDIA, fitImage, getImageSettings, IMAGE_TARGETS, saveMedia, type ImageTarget } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 512) * 1024 * 1024;

export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file がありません" }, { status: 400 });
  if (!ALLOWED_MEDIA[file.type]) return NextResponse.json({ error: `対応していない形式です: ${file.type || "不明"}` }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `ファイルが大きすぎます（上限 ${MAX_BYTES / 1024 / 1024}MB）` }, { status: 400 });
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  let type = file.type;
  // fit=eyecatch / section: note 向けのサイズ（見出し画像 1280×670 など）に中央基準で切り抜く
  const fit = form.get("fit");
  if (typeof fit === "string" && fit in IMAGE_TARGETS && type.startsWith("image/") && type !== "image/gif") {
    const out = await fitImage(bytes, fit as ImageTarget, (await getImageSettings()).format);
    bytes = out.bytes;
    type = out.mimeType;
  }
  const ref = await saveMedia(bytes, file.name, type);
  const alt = form.get("alt");
  return NextResponse.json({ media: { ...ref, ...(typeof alt === "string" && alt ? { alt } : {}) } });
});
