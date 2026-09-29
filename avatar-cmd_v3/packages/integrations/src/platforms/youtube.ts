// ================================================
// YouTube — YouTube Data API v3（動画アップロード）
// ================================================
// 公式: https://developers.google.com/youtube/v3/docs/videos/insert
//   - 認可:   https://accounts.google.com/o/oauth2/v2/auth（access_type=offline, PKCE S256）
//   - トークン: POST https://oauth2.googleapis.com/token
//   - 投稿:   POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//             → Location の URL に動画バイト列を PUT（再開可能アップロード）

import type { PlatformDefinition } from "../types";
import { ConfigError, expiresWithin, MINUTE, request, requestJson, requireFields, tokenTimes, deriveTitle } from "../http";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const youtube: PlatformDefinition = {
  id: "youtube",
  name: "YouTube",
  icon: "▶️",
  support: "official",
  connection: "oauth",
  maxLength: 5000,
  appFields: [
    { key: "clientId", label: "OAuth クライアント ID", required: true, help: "Google Cloud Console > API とサービス > 認証情報（種類: ウェブ アプリケーション）" },
    { key: "clientSecret", label: "クライアント シークレット", type: "password", required: true },
  ],
  accountFields: [],
  settingFields: [
    {
      key: "privacyStatus",
      label: "公開設定",
      type: "select",
      default: "public",
      options: [
        { value: "public", label: "公開" },
        { value: "unlisted", label: "限定公開" },
        { value: "private", label: "非公開" },
      ],
    },
    { key: "categoryId", label: "カテゴリID", default: "22", help: "22=ブログ, 27=教育, 28=科学と技術 など" },
    {
      key: "madeForKids",
      label: "子ども向け",
      type: "select",
      default: "false",
      options: [
        { value: "false", label: "いいえ" },
        { value: "true", label: "はい" },
      ],
    },
  ],
  postFields: [{ key: "title", label: "動画タイトル（100文字まで）" }],
  media: { image: false, video: true, required: "video", maxCount: 1 },
  docs: [
    { label: "videos.insert", url: "https://developers.google.com/youtube/v3/docs/videos/insert" },
    { label: "OAuth 2.0 (Web サーバー)", url: "https://developers.google.com/identity/protocols/oauth2/web-server" },
  ],
  notes: [
    "Google Cloud Console で「YouTube Data API v3」を有効化し、OAuth 同意画面を設定、承認済みリダイレクトURIに下記URIを登録してください。",
    "未監査の API プロジェクトからアップロードした動画は「非公開」に固定されます。公開するには YouTube API サービスの監査申請が必要です。",
    "既定のクォータは 1 日 10,000 ユニット、動画アップロードは 1 回 1,600 ユニットです（上限は Google Cloud Console で確認）。",
  ],
  oauth: {
    pkce: true,
    authorizeUrl(app, p) {
      requireFields("YouTube", app, ["clientId", "clientSecret"], "API連携アプリ");
      const q = new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: p.redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state: p.state,
        code_challenge: p.codeChallenge!,
        code_challenge_method: "S256",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchangeCode(app, p) {
      const t = await requestJson("youtube", TOKEN_URL, {
        method: "POST",
        form: {
          code: p.code,
          client_id: app.clientId,
          client_secret: app.clientSecret,
          redirect_uri: p.redirectUri,
          grant_type: "authorization_code",
          code_verifier: p.codeVerifier,
        },
      });
      const ch = await requestJson("youtube", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${t.access_token}` },
      });
      const c = ch.items?.[0];
      if (!c) throw new ConfigError("YouTube: このGoogleアカウントにはチャンネルがありません");
      return [
        {
          accountId: c.id,
          accountName: c.snippet?.title ?? c.id,
          profileUrl: c.snippet?.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : `https://www.youtube.com/channel/${c.id}`,
          credentials: { accessToken: t.access_token, refreshToken: t.refresh_token, ...tokenTimes(t.expires_in) },
          scopes: t.scope,
        },
      ];
    },
  },
  async refresh(app, cred) {
    if (!cred.refreshToken || !expiresWithin(cred.expiresAt, 5 * MINUTE)) return null;
    const t = await requestJson("youtube", TOKEN_URL, {
      method: "POST",
      form: { client_id: app.clientId, client_secret: app.clientSecret, refresh_token: cred.refreshToken, grant_type: "refresh_token" },
    });
    return { ...cred, accessToken: t.access_token, refreshToken: t.refresh_token ?? cred.refreshToken, ...tokenTimes(t.expires_in) };
  },
  async fetchProfile(ctx) {
    const token = ctx.credentials.accessToken;
    if (!token) throw new ConfigError("YouTube: アカウントを再接続してください");
    const d = await requestJson("youtube", "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", { headers: { Authorization: `Bearer ${token}` } });
    const st = d.items?.[0]?.statistics as { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean } | undefined;
    const n = (v?: string) => (v === undefined ? undefined : Number(v));
    return { followers: st?.hiddenSubscriberCount ? undefined : n(st?.subscriberCount), posts: n(st?.videoCount) };
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    if (!token) throw new ConfigError("YouTube: アカウントを再接続してください");
    const video = post.media.find((m) => m.mimeType.startsWith("video/"));
    if (!video) throw new ConfigError("YouTube: 動画ファイルを添付してください");
    const s = ctx.settings as Record<string, string>;
    const title = deriveTitle({ title: post.options.title || post.title, text: post.text }, 100).replace(/[<>]/g, "");
    const description = (post.link && !post.text.includes(post.link) ? `${post.text}\n\n${post.link}` : post.text).replace(/[<>]/g, "");

    const bytes = await video.load();
    const init = await request(
      "youtube",
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Upload-Content-Length": String(bytes.byteLength),
          "X-Upload-Content-Type": video.mimeType,
        },
        json: {
          snippet: { title, description: description.slice(0, 5000), tags: post.tags?.slice(0, 30), categoryId: s.categoryId || "22" },
          status: { privacyStatus: s.privacyStatus || "public", selfDeclaredMadeForKids: s.madeForKids === "true" },
        },
      }
    );
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube: アップロードURLが返されませんでした");
    const d = await requestJson("youtube", uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": video.mimeType },
      body: bytes as BodyInit,
    });
    return { postId: d.id, url: `https://www.youtube.com/watch?v=${d.id}` };
  },
};
