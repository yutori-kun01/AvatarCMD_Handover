// 外部 AI 用 API キーの管理（管理画面のみ。発行したキーの平文はこの応答でだけ返す）
import { NextResponse } from "next/server";
import { API_SCOPE_LABEL, API_SCOPES, apiV1Routes, issueApiKey, listApiAudit, listApiKeys, type IssueInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [keys, audit] = await Promise.all([listApiKeys(), listApiAudit(undefined, 50)]);
  return NextResponse.json({ keys, audit, scopes: API_SCOPES.map((s) => ({ id: s, label: API_SCOPE_LABEL[s] })), routes: apiV1Routes() });
});

export const POST = route(async (req: Request) => {
  const issued = await issueApiKey((await req.json()) as IssueInput);
  return NextResponse.json(issued, { headers: { "cache-control": "no-store" } });
});
