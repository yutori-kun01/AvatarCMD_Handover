// ================================================
// LinkedIn — Posts API (versioned REST: /rest/posts)
// ================================================
// 公式: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
//   - 認可:   https://www.linkedin.com/oauth/v2/authorization  scope: openid profile w_member_social
//   - トークン: POST https://www.linkedin.com/oauth/v2/accessToken（60日）
//   - 投稿者: GET https://api.linkedin.com/v2/userinfo → sub → urn:li:person:{sub}
//   - 投稿:   POST https://api.linkedin.com/rest/posts
//             ヘッダ: LinkedIn-Version: YYYYMM / X-Restli-Protocol-Version: 2.0.0
//   - 画像:   POST /rest/images?action=initializeUpload → uploadUrl に PUT
// 旧 /v2/ugcPosts は非推奨のため使わない。

import type { PlatformDefinition } from "../types";
import { ConfigError, expiresWithin, MINUTE, request, requestJson, requireFields, tokenTimes } from "../http";

const SCOPES = ["openid", "profile", "w_member_social"];
const API = "https://api.linkedin.com";

/** Posts API の commentary は "little text" 形式。予約文字はバックスラッシュでエスケープする */
export function escapeLittleText(s: string): string {
  return s.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => `\\${c}`);
}

function restHeaders(token: string, version: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0" };
}

export const linkedin: PlatformDefinition = {
  id: "linkedin",
  name: "LinkedIn",
  icon: "💼",
  support: "official",
  connection: "oauth",
  maxLength: 3000,
  appFields: [
    { key: "clientId", label: "Client ID", required: true },
    { key: "clientSecret", label: "Client Secret", type: "password", required: true },
  ],
  accountFields: [],
  settingFields: [
    {
      key: "authorUrn",
      label: "投稿者URN（任意）",
      placeholder: "urn:li:organization:123456",
      help: "会社ページとして投稿する場合のみ。w_organization_social 権限（Community Management API）が必要",
    },
  ],
  postFields: [],
  media: { image: true, video: false, maxCount: 20 },
  docs: [
    { label: "Posts API", url: "https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api" },
    { label: "Share on LinkedIn", url: "https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin" },
  ],
  notes: [
    "LinkedIn Developer Portal でアプリを作成し、Products から「Share on LinkedIn」と「Sign In with LinkedIn using OpenID Connect」を追加してください。",
    "Auth タブの Authorized redirect URLs に下記URIを登録します。",
    "アクセストークンは60日で失効します（リフレッシュトークンは承認済みパートナーのみ）。失効したら再接続してください。",
    "LinkedIn-Version はシステム設定で変更できます（毎月リリース・約1年サポート）。",
  ],
  oauth: {
    pkce: false,
    authorizeUrl(app, p) {
      requireFields("LinkedIn", app, ["clientId", "clientSecret"], "API連携アプリ");
      const q = new URLSearchParams({
        response_type: "code",
        client_id: app.clientId,
        redirect_uri: p.redirectUri,
        state: p.state,
        scope: SCOPES.join(" "),
      });
      return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
    },
    async exchangeCode(app, p) {
      const t = await requestJson("linkedin", "https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        form: {
          grant_type: "authorization_code",
          code: p.code,
          redirect_uri: p.redirectUri,
          client_id: app.clientId,
          client_secret: app.clientSecret,
        },
      });
      const me = await requestJson("linkedin", `${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      return [
        {
          accountId: me.sub,
          accountName: me.name ?? me.sub,
          credentials: {
            accessToken: t.access_token,
            refreshToken: t.refresh_token,
            personUrn: `urn:li:person:${me.sub}`,
            ...tokenTimes(t.expires_in),
          },
          scopes: t.scope,
        },
      ];
    },
  },
  async refresh(app, cred) {
    if (!cred.refreshToken || !expiresWithin(cred.expiresAt, 5 * MINUTE)) return null;
    const t = await requestJson("linkedin", "https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      form: { grant_type: "refresh_token", refresh_token: cred.refreshToken, client_id: app.clientId, client_secret: app.clientSecret },
    });
    return { ...cred, accessToken: t.access_token, refreshToken: t.refresh_token ?? cred.refreshToken, ...tokenTimes(t.expires_in) };
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    if (!token) throw new ConfigError("LinkedIn: アカウントを再接続してください");
    if (post.media.some((m) => m.mimeType.startsWith("video/"))) throw new ConfigError("LinkedIn: 動画投稿には未対応です（画像のみ）");
    const author = ((ctx.settings.authorUrn as string) || (ctx.credentials.personUrn as string) || `urn:li:person:${ctx.account.accountId}`).trim();
    const headers = restHeaders(token, ctx.system.linkedinVersion);

    const imageUrns: string[] = [];
    for (const m of post.media.slice(0, 20)) {
      const init = await requestJson("linkedin", `${API}/rest/images?action=initializeUpload`, {
        method: "POST",
        headers,
        json: { initializeUploadRequest: { owner: author } },
      });
      await request("linkedin", init.value.uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": m.mimeType },
        body: (await m.load()) as BodyInit,
      });
      imageUrns.push(init.value.image);
    }

    const text = post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text;
    const body: Record<string, unknown> = {
      author,
      commentary: escapeLittleText(text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (imageUrns.length === 1) body.content = { media: { id: imageUrns[0], ...(post.media[0].alt ? { altText: post.media[0].alt } : {}) } };
    if (imageUrns.length > 1) body.content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };

    const res = await request("linkedin", `${API}/rest/posts`, { method: "POST", headers, json: body });
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
    return { postId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined };
  },
};
