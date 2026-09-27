// ================================================
// Instagram — Instagram API with Instagram Login（プロアカウント）
// ================================================
// 公式: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
//   - 認可:       https://www.instagram.com/oauth/authorize
//                 scope: instagram_business_basic, instagram_business_content_publish
//   - 短期トークン: POST https://api.instagram.com/oauth/access_token
//   - 長期トークン: GET  https://graph.instagram.com/access_token?grant_type=ig_exchange_token (60日)
//   - 更新:       GET  https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
//   - 投稿:       POST https://graph.instagram.com/{ver}/{ig-user-id}/media → /media_publish
// Facebook ページとの連携は不要。ビジネス/クリエイターアカウントが対象。

import type { MediaFile, PlatformDefinition } from "../types";
import { ConfigError, DAY, expiresWithin, olderThan, poll, requestJson, requireFields, tokenTimes, withQuery } from "../http";

const GRAPH = "https://graph.instagram.com";
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

async function createContainer(base: string, uid: string, token: string, params: Record<string, string>): Promise<string> {
  const d = await requestJson("instagram", `${base}/${uid}/media`, { method: "POST", form: { ...params, access_token: token } });
  return d.id;
}

async function waitReady(base: string, id: string, token: string) {
  await poll(
    async () => {
      const s = await requestJson("instagram", withQuery(`${base}/${id}`, { fields: "status_code,status", access_token: token }));
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") return { done: false, error: s.status || s.status_code };
      return { done: s.status_code === "FINISHED" || s.status_code === "PUBLISHED" };
    },
    { intervalMs: 5000, label: "Instagram のメディア処理" }
  );
}

function itemParams(m: MediaFile, carousel: boolean): Record<string, string> {
  if (m.mimeType.startsWith("video/")) {
    return carousel ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" } : { media_type: "REELS", video_url: m.url };
  }
  return { image_url: m.url, ...(carousel ? { is_carousel_item: "true" } : {}), ...(m.alt ? { alt_text: m.alt } : {}) };
}

export const instagram: PlatformDefinition = {
  id: "instagram",
  name: "Instagram",
  icon: "📸",
  support: "official",
  connection: "oauth",
  maxLength: 2200,
  appFields: [
    { key: "appId", label: "Instagram App ID", required: true, help: "アプリダッシュボード > Instagram > API setup with Instagram login に表示" },
    { key: "appSecret", label: "Instagram App Secret", type: "password", required: true },
  ],
  accountFields: [],
  settingFields: [],
  postFields: [],
  media: { image: true, video: true, required: "any", maxCount: 10 },
  docs: [
    { label: "Instagram API with Instagram Login", url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login" },
    { label: "コンテンツ公開", url: "https://developers.facebook.com/docs/instagram-platform/content-publishing" },
  ],
  notes: [
    "Meta for Developers でビジネスタイプのアプリを作成し、Instagram 製品の「Instagram ログインによる API 設定」を追加してください。",
    "「ビジネスログインを設定」で下記のリダイレクトURIを登録します。",
    "投稿できるのはビジネス/クリエイターアカウントのみです。画像・動画の添付が必須です（テキストのみ不可）。",
    "画像は JPEG のみ、URL から取り込まれるため公開URLが外部から到達可能である必要があります。",
  ],
  oauth: {
    pkce: false,
    authorizeUrl(app, p) {
      requireFields("Instagram", app, ["appId", "appSecret"], "API連携アプリ");
      const q = new URLSearchParams({
        client_id: app.appId,
        redirect_uri: p.redirectUri,
        response_type: "code",
        scope: SCOPES.join(","),
        state: p.state,
      });
      return `https://www.instagram.com/oauth/authorize?${q}`;
    },
    async exchangeCode(app, p) {
      const shortRes = await requestJson("instagram", "https://api.instagram.com/oauth/access_token", {
        method: "POST",
        form: {
          client_id: app.appId,
          client_secret: app.appSecret,
          grant_type: "authorization_code",
          redirect_uri: p.redirectUri,
          code: p.code,
        },
      });
      const short = Array.isArray(shortRes.data) ? shortRes.data[0] : shortRes;
      const long = await requestJson(
        "instagram",
        withQuery(`${GRAPH}/access_token`, { grant_type: "ig_exchange_token", client_secret: app.appSecret, access_token: short.access_token })
      );
      const base = `${GRAPH}/${p.system.metaGraphVersion}`;
      const me = await requestJson("instagram", withQuery(`${base}/me`, { fields: "user_id,username", access_token: long.access_token }));
      const uid = String(me.user_id ?? me.id ?? short.user_id);
      return [
        {
          accountId: uid,
          accountName: `@${me.username}`,
          profileUrl: `https://www.instagram.com/${me.username}/`,
          credentials: { accessToken: long.access_token, userId: uid, ...tokenTimes(long.expires_in) },
          scopes: SCOPES.join(","),
        },
      ];
    },
  },
  async refresh(_app, cred) {
    if (!cred.accessToken || !expiresWithin(cred.expiresAt, 7 * DAY) || !olderThan(cred.issuedAt, DAY)) return null;
    const d = await requestJson("instagram", withQuery(`${GRAPH}/refresh_access_token`, { grant_type: "ig_refresh_token", access_token: cred.accessToken }));
    return { ...cred, accessToken: d.access_token, ...tokenTimes(d.expires_in) };
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    const uid = (ctx.credentials.userId as string) || ctx.account.accountId;
    if (!token) throw new ConfigError("Instagram: アカウントを再接続してください");
    if (!post.media.length) throw new ConfigError("Instagram: 画像または動画を1件以上添付してください");
    const base = `${GRAPH}/${ctx.system.metaGraphVersion}`;
    const caption = post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text;

    let creationId: string;
    if (post.media.length === 1) {
      creationId = await createContainer(base, uid, token, { ...itemParams(post.media[0], false), caption });
    } else {
      const children: string[] = [];
      for (const m of post.media.slice(0, 10)) {
        const id = await createContainer(base, uid, token, itemParams(m, true));
        if (m.mimeType.startsWith("video/")) await waitReady(base, id, token);
        children.push(id);
      }
      creationId = await createContainer(base, uid, token, { media_type: "CAROUSEL", children: children.join(","), caption });
    }
    await waitReady(base, creationId, token);

    const pub = await requestJson("instagram", `${base}/${uid}/media_publish`, { method: "POST", form: { creation_id: creationId, access_token: token } });
    const info = await requestJson("instagram", withQuery(`${base}/${pub.id}`, { fields: "permalink", access_token: token })).catch(() => ({}));
    return { postId: String(pub.id), url: (info as any).permalink };
  },
};
