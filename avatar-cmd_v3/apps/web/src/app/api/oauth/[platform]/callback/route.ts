// OAuth コールバック: 認可コードをトークンに交換してアカウントを保存
import { NextResponse } from "next/server";
import { errorMessage, finishOAuth, getSystemConfig } from "@avatar-cmd/integrations/server";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const q = new URL(req.url).searchParams;
  const base = (await getSystemConfig()).appUrl;
  const back = (p: Record<string, string>) =>
    NextResponse.redirect(`${base}/settings?${new URLSearchParams({ tab: "accounts", ...p })}`);

  const err = q.get("error_description") || q.get("error_message") || q.get("error");
  if (err) return back({ error: `${platform}: ${err}` });
  const code = q.get("code");
  const state = q.get("state");
  if (!code || !state) return back({ error: `${platform}: 認可コードがありません` });
  try {
    const saved = await finishOAuth(platform, state, code);
    return back({ connected: saved.map((s) => s.accountName).join(", ") });
  } catch (e) {
    return back({ error: errorMessage(e) });
  }
}
