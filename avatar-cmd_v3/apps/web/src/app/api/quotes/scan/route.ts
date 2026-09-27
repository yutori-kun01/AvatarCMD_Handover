// X のホームタイムラインから引用候補を探し、通過したものを下書きにする（手動実行）
import { NextResponse } from "next/server";
import { scanQuoteCandidates } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { accountId?: string; maxResults?: number };
  if (!b.accountId) return NextResponse.json({ error: "X アカウントを選択してください" }, { status: 400 });
  const maxResults = b.maxResults ? Math.min(Math.max(Math.floor(b.maxResults), 5), 100) : undefined;
  return NextResponse.json(await scanQuoteCandidates(b.accountId, { maxResults }));
});
