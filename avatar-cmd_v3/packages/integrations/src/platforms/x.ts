// ================================================
// X (Twitter) — X API v2 / OAuth 2.0 Authorization Code + PKCE
// ================================================
// 仕様の出典: X 公式 TypeScript SDK (@xdevplatform/xdk) が生成元とする OpenAPI
//   - 認可:   https://x.com/i/oauth2/authorize  (code_challenge_method=S256)
//   - トークン: POST https://api.x.com/2/oauth2/token（Confidential client は Basic 認証）
//   - 投稿:   POST https://api.x.com/2/tweets  { text, media: { media_ids } }
//   - メディア: POST https://api.x.com/2/media/upload（画像: 一括）
//              POST /2/media/upload/initialize → /{id}/append → /{id}/finalize（動画・GIF: 分割）
//              GET  /2/media/upload?command=STATUS&media_id=（処理待ち）
//   - スコープ: tweet.read tweet.write users.read media.write offline.access

import type { MediaFile, PlatformDefinition } from "../types";
import { ApiError, basicAuth, ConfigError, expiresWithin, MINUTE, poll, requestJson, requireFields, tokenTimes } from "../http";

const API = "https://api.x.com";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const CHUNK = 2 * 1024 * 1024; // append 1回あたりのバイト数（base64化前）

function tokenHeaders(app: Record<string, string>): Record<string, string> {
  return app.clientSecret ? { Authorization: basicAuth(app.clientId, app.clientSecret) } : {};
}

async function tokenRequest(app: Record<string, string>, form: Record<string, string>) {
  const d = await requestJson("x", `${API}/2/oauth2/token`, {
    method: "POST",
    headers: tokenHeaders(app),
    form: { ...form, ...(app.clientSecret ? {} : { client_id: app.clientId }) },
  });
  return {
    accessToken: d.access_token as string,
    refreshToken: d.refresh_token as string | undefined,
    scope: d.scope as string | undefined,
    ...tokenTimes(d.expires_in),
  };
}

async function uploadMedia(token: string, m: MediaFile): Promise<string> {
  const auth = { Authorization: `Bearer ${token}` };
  const bytes = Buffer.from(await m.load());
  const isVideo = m.mimeType.startsWith("video/");
  const isGif = m.mimeType === "image/gif";

  if (!isVideo && !isGif) {
    const d = await requestJson("x", `${API}/2/media/upload`, {
      method: "POST",
      headers: auth,
      json: { media: bytes.toString("base64"), media_category: "tweet_image" },
    });
    return d.data.id;
  }

  const init = await requestJson("x", `${API}/2/media/upload/initialize`, {
    method: "POST",
    headers: auth,
    json: { media_type: m.mimeType, total_bytes: bytes.length, media_category: isVideo ? "tweet_video" : "tweet_gif" },
  });
  const id: string = init.data.id;
  for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg++) {
    await requestJson("x", `${API}/2/media/upload/${id}/append`, {
      method: "POST",
      headers: auth,
      json: { media: bytes.subarray(i, i + CHUNK).toString("base64"), segment_index: seg },
    });
  }
  const fin = await requestJson("x", `${API}/2/media/upload/${id}/finalize`, { method: "POST", headers: auth });
  let info = fin.data?.processing_info;
  if (info) {
    await poll(
      async () => {
        if (info.state === "succeeded") return { done: true };
        if (info.state === "failed") return { done: false, error: JSON.stringify(info.error ?? info) };
        const s = await requestJson("x", `${API}/2/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`, { headers: auth });
        info = s.data?.processing_info ?? { state: "succeeded" };
        return { done: info.state === "succeeded", error: info.state === "failed" ? JSON.stringify(info.error ?? info) : undefined };
      },
      { intervalMs: 3000, label: "X の動画処理" }
    );
  }
  return id;
}

export const x: PlatformDefinition = {
  id: "x",
  name: "X (Twitter)",
  icon: "𝕏",
  support: "official",
  connection: "oauth",
  maxLength: 280,
  appFields: [
    { key: "clientId", label: "OAuth 2.0 Client ID", required: true },
    { key: "clientSecret", label: "OAuth 2.0 Client Secret", type: "password", help: "Confidential client（Web App）の場合に入力。Public client なら空欄" },
  ],
  accountFields: [],
  settingFields: [],
  postFields: [],
  media: { image: true, video: true, maxCount: 4 },
  docs: [
    { label: "X Developer Console", url: "https://console.x.com" },
    { label: "Create Post", url: "https://docs.x.com/x-api/posts/create-post" },
    { label: "Media Upload", url: "https://docs.x.com/x-api/media/quickstart/media-upload-chunked" },
  ],
  notes: [
    "アプリの User authentication settings で OAuth 2.0 を有効化し、App permissions を「Read and write」にしてください。",
    "Type of App は「Web App, Automated App or Bot」(Confidential client) を推奨します。",
    "投稿APIの利用には X API のクレジット（従量課金）または該当プランが必要です。",
  ],
  oauth: {
    pkce: true,
    authorizeUrl(app, p) {
      requireFields("X", app, ["clientId"], "API連携アプリ");
      const q = new URLSearchParams({
        response_type: "code",
        client_id: app.clientId,
        redirect_uri: p.redirectUri,
        scope: SCOPES.join(" "),
        state: p.state,
        code_challenge: p.codeChallenge!,
        code_challenge_method: "S256",
      });
      return `https://x.com/i/oauth2/authorize?${q}`;
    },
    async exchangeCode(app, p) {
      const t = await tokenRequest(app, {
        grant_type: "authorization_code",
        code: p.code,
        redirect_uri: p.redirectUri,
        code_verifier: p.codeVerifier!,
      });
      const me = await requestJson("x", `${API}/2/users/me`, { headers: { Authorization: `Bearer ${t.accessToken}` } });
      return [
        {
          accountId: me.data.id,
          accountName: `@${me.data.username}`,
          profileUrl: `https://x.com/${me.data.username}`,
          credentials: { ...t, username: me.data.username },
          scopes: t.scope,
        },
      ];
    },
  },
  async refresh(app, cred) {
    if (!cred.refreshToken || !expiresWithin(cred.expiresAt, 5 * MINUTE)) return null;
    const t = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: cred.refreshToken });
    // X はリフレッシュトークンをローテーションする
    return { ...cred, ...t, refreshToken: t.refreshToken ?? cred.refreshToken };
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    if (!token) throw new ConfigError("X: アカウントを再接続してください（アクセストークンなし）");
    const videos = post.media.filter((m) => m.mimeType.startsWith("video/") || m.mimeType === "image/gif");
    if (videos.length && post.media.length > 1) throw new ConfigError("X: 動画・GIF は1件のみ添付できます（画像との混在不可）");
    const mediaIds: string[] = [];
    for (const m of post.media.slice(0, 4)) mediaIds.push(await uploadMedia(token, m));

    const body: Record<string, unknown> = { text: post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text };
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    const d = await requestJson("x", `${API}/2/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      json: body,
    }).catch((e) => {
      if (e instanceof ApiError && e.status === 402) throw new ConfigError(`X: API クレジット/プランが不足しています (${e.body.slice(0, 200)})`);
      throw e;
    });
    const username = (ctx.credentials.username as string) || ctx.account.accountName.replace(/^@/, "");
    return { postId: d.data.id, url: `https://x.com/${username}/status/${d.data.id}` };
  },
};
