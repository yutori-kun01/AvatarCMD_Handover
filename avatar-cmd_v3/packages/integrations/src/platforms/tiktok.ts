// ================================================
// TikTok — Content Posting API（Direct Post）
// ================================================
// 公式: https://developers.tiktok.com/doc/content-posting-api-get-started
//   - 認可:   https://www.tiktok.com/v2/auth/authorize/  scope: user.info.basic,video.publish
//   - トークン: POST https://open.tiktokapis.com/v2/oauth/token/（access 24時間 / refresh 365日）
//   - 投稿前に必須: POST /v2/post/publish/creator_info/query/（公開範囲の選択肢を取得）
//   - 動画:   POST /v2/post/publish/video/init/（source=FILE_UPLOAD）→ upload_url に PUT（Content-Range）
//   - 写真:   POST /v2/post/publish/content/init/（source=PULL_FROM_URL, 要ドメイン所有確認）
//   - 状態:   POST /v2/post/publish/status/fetch/
// 未監査アプリは公開範囲 SELF_ONLY（自分のみ）でしか投稿できない。

import type { PlatformDefinition } from "../types";
import { ConfigError, expiresWithin, MINUTE, poll, request, requestJson, requireFields, tokenTimes } from "../http";

const API = "https://open.tiktokapis.com";
const SCOPES = ["user.info.basic", "video.publish"];
const MB = 1024 * 1024;

function authJson(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" };
}

function check(d: any, what: string) {
  if (d?.error?.code && d.error.code !== "ok") throw new Error(`TikTok ${what}: ${d.error.code} ${d.error.message ?? ""}`);
  return d.data;
}

async function tokenRequest(app: Record<string, string>, form: Record<string, string>) {
  const d = await requestJson("tiktok", `${API}/v2/oauth/token/`, {
    method: "POST",
    form: { client_key: app.clientKey, client_secret: app.clientSecret, ...form },
  });
  if (d.error && d.error !== "ok" && typeof d.error === "string") throw new Error(`TikTok token: ${d.error} ${d.error_description ?? ""}`);
  return {
    accessToken: d.access_token as string,
    refreshToken: d.refresh_token as string,
    openId: d.open_id as string,
    scope: d.scope as string,
    ...tokenTimes(d.expires_in),
  };
}

/** TikTok の分割ルール: 1チャンク 5MB〜64MB、最後のチャンクは128MBまで。5MB未満は1チャンク */
export function tiktokChunks(size: number): { chunkSize: number; count: number } {
  if (size < 5 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  const count = Math.max(1, Math.floor(size / chunkSize));
  return { chunkSize, count };
}

export const tiktok: PlatformDefinition = {
  id: "tiktok",
  name: "TikTok",
  icon: "🎵",
  support: "official",
  connection: "oauth",
  maxLength: 2200,
  appFields: [
    { key: "clientKey", label: "Client Key", required: true },
    { key: "clientSecret", label: "Client Secret", type: "password", required: true },
  ],
  accountFields: [],
  settingFields: [
    {
      key: "privacyLevel",
      label: "公開範囲（必須）",
      type: "select",
      help: "TikTok のガイドラインにより既定値はありません。未監査アプリは「自分のみ」しか使えません",
      options: [
        { value: "", label: "— 選択してください —" },
        { value: "SELF_ONLY", label: "自分のみ" },
        { value: "MUTUAL_FOLLOW_FRIENDS", label: "相互フォロー" },
        { value: "FOLLOWER_OF_CREATOR", label: "フォロワー" },
        { value: "PUBLIC_TO_EVERYONE", label: "全員に公開" },
      ],
    },
    {
      key: "disableComment",
      label: "コメント",
      type: "select",
      default: "false",
      options: [
        { value: "false", label: "許可" },
        { value: "true", label: "オフ" },
      ],
    },
  ],
  postFields: [],
  media: { image: true, video: true, required: "any", maxCount: 35 },
  docs: [
    { label: "Content Posting API", url: "https://developers.tiktok.com/doc/content-posting-api-get-started" },
    { label: "Direct Post リファレンス", url: "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post" },
    { label: "Login Kit (Web)", url: "https://developers.tiktok.com/doc/login-kit-web" },
  ],
  notes: [
    "TikTok for Developers でアプリを作成し、Login Kit と Content Posting API（Direct Post を有効化）を追加、Redirect URI に下記URIを登録してください。",
    "監査（Audit）前のアプリは、公開範囲「自分のみ」でしか投稿できません。一般公開するには TikTok の審査が必要です。",
    "写真投稿は URL 取り込み方式のため、公開URLのドメインを TikTok 開発者ポータルで所有確認する必要があります。動画はファイル送信のため不要です。",
  ],
  oauth: {
    pkce: false,
    authorizeUrl(app, p) {
      requireFields("TikTok", app, ["clientKey", "clientSecret"], "API連携アプリ");
      const q = new URLSearchParams({
        client_key: app.clientKey,
        scope: SCOPES.join(","),
        response_type: "code",
        redirect_uri: p.redirectUri,
        state: p.state,
      });
      return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
    },
    async exchangeCode(app, p) {
      const t = await tokenRequest(app, { code: p.code, grant_type: "authorization_code", redirect_uri: p.redirectUri });
      const info = await requestJson("tiktok", `${API}/v2/user/info/?fields=open_id,display_name,username`, {
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });
      const u = check(info, "user/info")?.user ?? {};
      return [
        {
          accountId: t.openId || u.open_id,
          accountName: u.username ? `@${u.username}` : u.display_name ?? "TikTok",
          profileUrl: u.username ? `https://www.tiktok.com/@${u.username}` : undefined,
          credentials: t,
          scopes: t.scope,
        },
      ];
    },
  },
  async refresh(app, cred) {
    if (!cred.refreshToken || !expiresWithin(cred.expiresAt, 5 * MINUTE)) return null;
    const t = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: cred.refreshToken });
    return { ...cred, ...t };
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    if (!token) throw new ConfigError("TikTok: アカウントを再接続してください");
    const s = ctx.settings as Record<string, string>;
    if (!s.privacyLevel) throw new ConfigError("TikTok: アカウント設定で公開範囲を選択してください");
    if (!post.media.length) throw new ConfigError("TikTok: 動画または写真を添付してください");

    const creator = check(
      await requestJson("tiktok", `${API}/v2/post/publish/creator_info/query/`, { method: "POST", headers: authJson(token), json: {} }),
      "creator_info"
    );
    const allowed: string[] = creator?.privacy_level_options ?? [];
    if (allowed.length && !allowed.includes(s.privacyLevel)) {
      throw new ConfigError(`TikTok: 公開範囲 ${s.privacyLevel} はこのアカウントで使えません（選択肢: ${allowed.join(", ")}）`);
    }
    const disableComment = s.disableComment === "true" || !!creator?.comment_disabled;
    const caption = post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text;
    const video = post.media.find((m) => m.mimeType.startsWith("video/"));

    let publishId: string;
    if (video) {
      const bytes = await video.load();
      const { chunkSize, count } = tiktokChunks(bytes.byteLength);
      const init = check(
        await requestJson("tiktok", `${API}/v2/post/publish/video/init/`, {
          method: "POST",
          headers: authJson(token),
          json: {
            post_info: {
              title: caption.slice(0, 2200),
              privacy_level: s.privacyLevel,
              disable_comment: disableComment,
              disable_duet: !!creator?.duet_disabled,
              disable_stitch: !!creator?.stitch_disabled,
              video_cover_timestamp_ms: 1000,
            },
            source_info: { source: "FILE_UPLOAD", video_size: bytes.byteLength, chunk_size: chunkSize, total_chunk_count: count },
          },
        }),
        "video/init"
      );
      publishId = init.publish_id;
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? bytes.byteLength : start + chunkSize;
        await request("tiktok", init.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": video.mimeType,
            "Content-Length": String(end - start),
            "Content-Range": `bytes ${start}-${end - 1}/${bytes.byteLength}`,
          },
          body: bytes.subarray(start, end) as BodyInit,
        });
      }
    } else {
      const init = check(
        await requestJson("tiktok", `${API}/v2/post/publish/content/init/`, {
          method: "POST",
          headers: authJson(token),
          json: {
            post_info: {
              title: (post.options.title || post.title || "").slice(0, 90),
              description: caption.slice(0, 4000),
              privacy_level: s.privacyLevel,
              disable_comment: disableComment,
            },
            source_info: { source: "PULL_FROM_URL", photo_images: post.media.slice(0, 35).map((m) => m.url), photo_cover_index: 0 },
            post_mode: "DIRECT_POST",
            media_type: "PHOTO",
          },
        }),
        "content/init"
      );
      publishId = init.publish_id;
    }

    const postId = await poll<string>(
      async () => {
        const st = check(
          await requestJson("tiktok", `${API}/v2/post/publish/status/fetch/`, { method: "POST", headers: authJson(token), json: { publish_id: publishId } }),
          "status/fetch"
        );
        if (st.status === "FAILED") return { done: false, error: st.fail_reason ?? "FAILED" };
        const ids = st.publicaly_available_post_id ?? st.publicly_available_post_id ?? [];
        return { done: st.status === "PUBLISH_COMPLETE", value: ids[0] ? String(ids[0]) : publishId };
      },
      { intervalMs: 5000, label: "TikTok の投稿処理" }
    );
    const user = ctx.account.accountName.startsWith("@") ? ctx.account.accountName : "";
    return {
      postId,
      url: user && postId !== publishId ? `https://www.tiktok.com/${user}/video/${postId}` : undefined,
      note: s.privacyLevel === "SELF_ONLY" ? "公開範囲「自分のみ」で投稿しました" : undefined,
    };
  },
};
