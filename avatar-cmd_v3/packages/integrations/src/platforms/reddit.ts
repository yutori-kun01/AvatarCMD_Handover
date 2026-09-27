// ================================================
// Reddit — Reddit Data API (OAuth2)
// ================================================
// 公式: https://github.com/reddit-archive/reddit/wiki/OAuth2 / https://www.reddit.com/dev/api#POST_api_submit
//   - 認可:   https://www.reddit.com/api/v1/authorize（duration=permanent）scope: identity submit
//   - トークン: POST https://www.reddit.com/api/v1/access_token（Basic 認証, 1時間）
//   - 投稿:   POST https://oauth.reddit.com/api/submit（kind=self|link, api_type=json）
//   - User-Agent 必須: "<platform>:<app id>:<version> (by /u/<username>)"
// 2025年11月以降、新規アプリは Responsible Builder Policy に基づく事前承認が必要。

import type { PlatformDefinition } from "../types";
import { basicAuth, ConfigError, deriveTitle, expiresWithin, MINUTE, requestJson, requireFields, tokenTimes } from "../http";

const SCOPES = ["identity", "submit"];

function userAgent(app: Record<string, string>, username?: string) {
  return app.userAgent || `server:avatar-cmd:3.1 (by /u/${username || "unknown"})`;
}

async function token(app: Record<string, string>, form: Record<string, string>, username?: string) {
  const d = await requestJson("reddit", "https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: basicAuth(app.clientId, app.clientSecret), "User-Agent": userAgent(app, username) },
    form,
  });
  if (d.error) throw new ConfigError(`Reddit: トークン取得に失敗しました (${d.error})`);
  return { accessToken: d.access_token as string, refreshToken: d.refresh_token as string | undefined, scope: d.scope as string, ...tokenTimes(d.expires_in) };
}

export const reddit: PlatformDefinition = {
  id: "reddit",
  name: "Reddit",
  icon: "🟠",
  support: "official",
  connection: "oauth",
  maxLength: 40000,
  appFields: [
    { key: "clientId", label: "Client ID", required: true, help: "アプリ名の下に表示される14文字前後の文字列" },
    { key: "clientSecret", label: "Client Secret", type: "password", required: true },
    { key: "userAgent", label: "User-Agent", placeholder: "server:avatar-cmd:3.1 (by /u/yourname)", help: "Reddit の API ルールで必須。空欄なら自動生成" },
  ],
  accountFields: [],
  settingFields: [{ key: "subreddit", label: "既定の投稿先 subreddit", placeholder: "test", help: "r/ は不要" }],
  postFields: [
    { key: "subreddit", label: "subreddit（空欄なら既定）" },
    { key: "title", label: "タイトル（300文字まで）" },
  ],
  media: { image: false, video: false, maxCount: 0 },
  docs: [
    { label: "Reddit Data API Wiki", url: "https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki" },
    { label: "Responsible Builder Policy", url: "https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy" },
    { label: "POST /api/submit", url: "https://www.reddit.com/dev/api#POST_api_submit" },
  ],
  notes: [
    "https://www.reddit.com/prefs/apps で「web app」を作成し、redirect uri に下記URIを登録してください。",
    "新規アプリは Reddit の Responsible Builder Policy に基づく API アクセス申請・承認が必要です（数週間かかる場合があります）。",
    "テキスト投稿（本文）とリンク投稿に対応。画像投稿は未対応です。",
  ],
  oauth: {
    pkce: false,
    authorizeUrl(app, p) {
      requireFields("Reddit", app, ["clientId", "clientSecret"], "API連携アプリ");
      const q = new URLSearchParams({
        client_id: app.clientId,
        response_type: "code",
        state: p.state,
        redirect_uri: p.redirectUri,
        duration: "permanent",
        scope: SCOPES.join(" "),
      });
      return `https://www.reddit.com/api/v1/authorize?${q}`;
    },
    async exchangeCode(app, p) {
      const t = await token(app, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri });
      const me = await requestJson("reddit", "https://oauth.reddit.com/api/v1/me", {
        headers: { Authorization: `Bearer ${t.accessToken}`, "User-Agent": userAgent(app) },
      });
      return [
        {
          accountId: me.id ?? me.name,
          accountName: `u/${me.name}`,
          profileUrl: `https://www.reddit.com/user/${me.name}`,
          credentials: { ...t, username: me.name },
          scopes: t.scope,
        },
      ];
    },
  },
  async refresh(app, cred) {
    if (!cred.refreshToken || !expiresWithin(cred.expiresAt, 5 * MINUTE)) return null;
    const t = await token(app, { grant_type: "refresh_token", refresh_token: cred.refreshToken as string }, cred.username as string);
    return { ...cred, ...t, refreshToken: t.refreshToken ?? cred.refreshToken };
  },
  async publish(ctx, post) {
    const tok = ctx.credentials.accessToken;
    if (!tok) throw new ConfigError("Reddit: アカウントを再接続してください");
    const sr = (post.options.subreddit || (ctx.settings.subreddit as string) || "").replace(/^\/?r\//, "").trim();
    if (!sr) throw new ConfigError("Reddit: 投稿先 subreddit を指定してください（アカウント設定または投稿時）");
    const title = deriveTitle({ title: post.options.title || post.title, text: post.text }, 300);
    const isLink = !!post.link && post.text.trim() === post.link.trim();
    const d = await requestJson("reddit", "https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "User-Agent": userAgent(ctx.app, ctx.credentials.username as string) },
      form: isLink
        ? { api_type: "json", kind: "link", sr, title, url: post.link, resubmit: "true" }
        : { api_type: "json", kind: "self", sr, title, text: post.link && !post.text.includes(post.link) ? `${post.text}\n\n${post.link}` : post.text },
    });
    const errors: unknown[] = d.json?.errors ?? [];
    if (errors.length) throw new Error(`Reddit: ${JSON.stringify(errors)}`);
    return { postId: d.json?.data?.name ?? d.json?.data?.id, url: d.json?.data?.url };
  },
};
