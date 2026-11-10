// エクスポートしたファイルの取り込み（multipart の file）。アバターは新しい ID で作る（同じファイルを 2 回取り込むと 2 体ずつできる）
import { NextResponse } from "next/server";
import { ConfigError } from "@avatar-cmd/integrations";
import { importAvatars } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  // このルートは middleware の対象外（本文の大きさの上限を避けるため）。ログインと CSRF の確認は route() が行う（lib/guard.ts）
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ConfigError("ファイルを選んでください");
  return NextResponse.json({ result: await importAvatars(new Uint8Array(await file.arrayBuffer())) });
});
