// アカウント接続（アプリパスワード・トークン・Cookie 等、OAuth 以外）
import { NextResponse } from "next/server";
import { connectWithCredentials, listAccounts } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const GET = route(async () => NextResponse.json({ accounts: await listAccounts() }));

export const POST = route(async (req: Request) => {
  const { platform, avatarId, input } = (await req.json()) as { platform: string; avatarId: string; input: Record<string, string> };
  const acc = await connectWithCredentials(platform, avatarId, input ?? {});
  return NextResponse.json({ ok: true, id: acc.id, accountName: acc.accountName });
});
