// ================================================
// Facebook ページ — Graph API (Pages API)
// ================================================
// 公式: https://developers.facebook.com/docs/pages-api
//   - 認可:   https://www.facebook.com/{ver}/dialog/oauth
//             scope: pages_show_list, pages_manage_posts, pages_read_engagement
//   - トークン: GET https://graph.facebook.com/{ver}/oauth/access_token（→ fb_exchange_token で長期化）
//   - ページ: GET /me/accounts（長期ユーザートークンから取得したページトークンは失効しない）
//   - 投稿:   POST /{page-id}/feed | /{page-id}/photos | graph-video.facebook.com/{page-id}/videos
// 個人タイムラインへの API 投稿は Meta が提供していないため、対象は Facebook ページのみ。

import type { PlatformDefinition } from "../types";
import { ConfigError, requestJson, requireFields, withQuery } from "../http";

const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

export const facebook: PlatformDefinition = {
  id: "facebook",
  name: "Facebook ページ",
  icon: "📘",
  support: "official",
  connection: "oauth",
  maxLength: 63206,
  appFields: [
    { key: "appId", label: "App ID", required: true },
    { key: "appSecret", label: "App Secret", type: "password", required: true },
  ],
  accountFields: [],
  settingFields: [],
  postFields: [],
  media: { image: true, video: true, maxCount: 10 },
  docs: [
    { label: "Pages API", url: "https://developers.facebook.com/docs/pages-api/posts" },
    { label: "Facebook ログイン", url: "https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow" },
  ],
  notes: [
    "Meta for Developers でビジネスタイプのアプリを作成し「Facebook ログイン for Business」を追加、有効なOAuthリダイレクトURIに下記URIを登録してください。",
    "接続すると、管理している Facebook ページごとに投稿先アカウントが作成されます（個人タイムラインへの投稿は API 非対応）。",
    "他人が管理するページで使う場合はアプリレビュー（pages_manage_posts 等）が必要です。",
  ],
  oauth: {
    pkce: false,
    authorizeUrl(app, p) {
      requireFields("Facebook", app, ["appId", "appSecret"], "API連携アプリ");
      const q = new URLSearchParams({
        client_id: app.appId,
        redirect_uri: p.redirectUri,
        state: p.state,
        response_type: "code",
        scope: SCOPES.join(","),
      });
      return `https://www.facebook.com/${p.system.metaGraphVersion}/dialog/oauth?${q}`;
    },
    async exchangeCode(app, p) {
      const base = `https://graph.facebook.com/${p.system.metaGraphVersion}`;
      const short = await requestJson(
        "facebook",
        withQuery(`${base}/oauth/access_token`, { client_id: app.appId, client_secret: app.appSecret, redirect_uri: p.redirectUri, code: p.code })
      );
      const long = await requestJson(
        "facebook",
        withQuery(`${base}/oauth/access_token`, {
          grant_type: "fb_exchange_token",
          client_id: app.appId,
          client_secret: app.appSecret,
          fb_exchange_token: short.access_token,
        })
      );
      const pages = await requestJson(
        "facebook",
        withQuery(`${base}/me/accounts`, { fields: "id,name,access_token,link", limit: "100", access_token: long.access_token })
      );
      const list: any[] = pages.data ?? [];
      if (!list.length) throw new ConfigError("Facebook: 管理しているページが見つかりません（ページの権限を許可したか確認してください）");
      return list.map((pg) => ({
        accountId: String(pg.id),
        accountName: pg.name,
        profileUrl: pg.link || `https://www.facebook.com/${pg.id}`,
        credentials: { accessToken: pg.access_token, pageId: String(pg.id), issuedAt: new Date().toISOString() },
        scopes: SCOPES.join(","),
      }));
    },
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    const pageId = (ctx.credentials.pageId as string) || ctx.account.accountId;
    if (!token) throw new ConfigError("Facebook: アカウントを再接続してください");
    const ver = ctx.system.metaGraphVersion;
    const base = `https://graph.facebook.com/${ver}`;
    const videos = post.media.filter((m) => m.mimeType.startsWith("video/"));
    const images = post.media.filter((m) => !m.mimeType.startsWith("video/"));

    if (videos.length) {
      if (post.media.length > 1) throw new ConfigError("Facebook: 動画は1件のみ（画像との混在不可）です");
      const d = await requestJson("facebook", `https://graph-video.facebook.com/${ver}/${pageId}/videos`, {
        method: "POST",
        form: { file_url: videos[0].url, description: post.text, ...(post.title ? { title: post.title } : {}), access_token: token },
      });
      return { postId: String(d.id), url: `https://www.facebook.com/${pageId}/videos/${d.id}` };
    }

    if (images.length === 1) {
      const d = await requestJson("facebook", `${base}/${pageId}/photos`, {
        method: "POST",
        form: { url: images[0].url, message: post.text, access_token: token },
      });
      const id = String(d.post_id ?? d.id);
      return { postId: id, url: `https://www.facebook.com/${id}` };
    }

    const form: Record<string, string> = { message: post.text, access_token: token };
    if (post.link) form.link = post.link;
    for (const [i, m] of images.slice(0, 10).entries()) {
      const ph = await requestJson("facebook", `${base}/${pageId}/photos`, {
        method: "POST",
        form: { url: m.url, published: "false", access_token: token },
      });
      form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: ph.id });
    }
    const d = await requestJson("facebook", `${base}/${pageId}/feed`, { method: "POST", form });
    return { postId: String(d.id), url: `https://www.facebook.com/${d.id}` };
  },
};
