// 投稿用メディアの公開配信（Instagram / Threads / Facebook などが URL から取り込む）
// ファイル名は推測不能な UUID。一覧は公開しない。保存先が R2 のときは R2 から読んで返す（URL は変わらない）
import { readMedia } from "@avatar-cmd/integrations/server";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const buf = await readMedia(name);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[name.split(".").pop()!] ?? "application/octet-stream",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
