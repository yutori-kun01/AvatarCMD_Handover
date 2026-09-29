// OAuth コールバック: 認可コードをトークンに交換してアカウントを保存
// 別ブラウザで開いた認可 URL からも戻ってくるため、ログイン不要（1回限りの state で本人の依頼か確かめる）
import { NextResponse } from "next/server";
import { errorMessage, finishOAuth, getOAuthMode, getSystemConfig, recordOAuthResult, sameAccountWarnings } from "@avatar-cmd/integrations/server";

export const runtime = "nodejs";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 別ブラウザ用の完了ページ。結果は元の画面に自動で反映される */
function donePage(ok: boolean, message: string) {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avatar CMD — ${ok ? "接続しました" : "接続できませんでした"}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b10;color:#eee;font-family:system-ui,sans-serif}
main{max-width:480px;padding:32px;border:1px solid #ffffff1a;border-radius:16px;background:#ffffff08}h1{font-size:18px;margin:0 0 12px}
p{font-size:14px;line-height:1.7;color:#ffffffb3}.ok{color:#6ee7b7}.ng{color:#fca5a5}</style></head>
<body><main><h1 class="${ok ? "ok" : "ng"}">${ok ? "✓ 接続しました" : "接続できませんでした"}</h1><p>${esc(message)}</p>
<p>元のブラウザの Avatar CMD の画面に、結果が自動で反映されます。このタブは閉じて構いません。</p></main></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const q = new URL(req.url).searchParams;
  const base = (await getSystemConfig()).appUrl;
  const code = q.get("code");
  const state = q.get("state");
  const external = state ? (await getOAuthMode(state)) === "external" : false;

  const finish = async (ok: boolean, message: string) => {
    if (external) {
      await recordOAuthResult(state!, { ok, message });
      return donePage(ok, message);
    }
    return NextResponse.redirect(`${base}/settings?${new URLSearchParams({ tab: "accounts", ...(ok ? { connected: message } : { error: message }) })}`);
  };

  const err = q.get("error_description") || q.get("error_message") || q.get("error");
  if (err) return finish(false, `${platform}: ${err}`);
  if (!code || !state) return finish(false, `${platform}: 認可コードがありません`);
  try {
    const saved = await finishOAuth(platform, state, code);
    const warnings = await sameAccountWarnings(saved);
    if (warnings.length) return finish(false, warnings.join(" / "));
    return finish(true, saved.map((s) => s.accountName).join(", "));
  } catch (e) {
    return finish(false, errorMessage(e));
  }
}
