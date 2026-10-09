// メディアの保存先（ローカル / Cloudflare R2）: 状態（GET）・保存（PUT）・接続テストと R2 への移行（POST）
import { NextResponse } from "next/server";
import { describeMediaStorage, migrateMediaToR2, saveMediaStorage, testMediaStorage } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ storage: await describeMediaStorage() }));

export const PUT = route(async (req: Request) => NextResponse.json({ storage: await saveMediaStorage(await req.json()) }));

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { action: "test" | "migrate"; deleteLocal?: boolean; after?: string };
  if (b.action === "test") {
    await testMediaStorage();
    return NextResponse.json({ ok: true });
  }
  if (b.action === "migrate") return NextResponse.json({ result: await migrateMediaToR2({ limit: 100, deleteLocal: !!b.deleteLocal, after: b.after || undefined }), storage: await describeMediaStorage() });
  return NextResponse.json({ error: "action が不正です" }, { status: 400 });
});
