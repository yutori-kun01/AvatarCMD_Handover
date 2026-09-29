// フォロワー数: 値を送れば手入力として記録、空なら API から今すぐ取得
import { NextResponse } from "next/server";
import { ConfigError } from "@avatar-cmd/integrations";
import { refreshFollowers, saveProfileStats } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { followers?: number | string | null };
  if (b.followers === undefined || b.followers === null || b.followers === "") return NextResponse.json({ ok: true, stats: await refreshFollowers(id) });
  const followers = Number(String(b.followers).replace(/[,，\s]/g, ""));
  if (!Number.isInteger(followers) || followers < 0) throw new ConfigError("フォロワー数は0以上の整数で入力してください");
  return NextResponse.json({ ok: true, stats: await saveProfileStats(id, { followers }) });
});
