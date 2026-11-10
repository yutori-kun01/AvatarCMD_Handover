// エクスポートしたファイルの取り込み（multipart の file）。アバターは新しい ID で作る（同じファイルを 2 回取り込むと 2 体ずつできる）
import { NextResponse } from "next/server";
import { ConfigError } from "@avatar-cmd/integrations";
import { importAvatars } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  // このルートは middleware の対象外（本文の大きさの上限を避けるため）なので、ここでログインを確認する
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!(await verifySessionToken(token ? decodeURIComponent(token) : undefined).catch(() => false))) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ConfigError("ファイルを選んでください");
  return NextResponse.json({ result: await importAvatars(new Uint8Array(await file.arrayBuffer())) });
});
