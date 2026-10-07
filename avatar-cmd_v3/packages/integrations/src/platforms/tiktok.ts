// ================================================
// TikTok — Content Posting API（Direct Post）
// ================================================
// 公式: https://developers.tiktok.com/doc/content-posting-api-get-started
//   - 認可:   https://www.tiktok.com/v2/auth/authorize/  scope: user.info.basic,video.publish
//   - トークン: POST https://open.tiktokapis.com/v2/oauth/token/（access 24時間 / refresh 365日）
//   - 投稿前に必須: POST /v2/post/publish/creator_info/query/（公開範囲の選択肢を取得）
//   - 動画:   POST /v2/post/publish/video/init/（source=FILE_UPLOAD）→ upload_url に PUT（Content-Range）
//   - 写真:   POST /v2/post/publish/content/init/（source=PULL_FROM_URL, 要ドメイン所有確認）
//   - 下書き: POST /v2/post/publish/inbox/video/init/（video.upload 権限。TikTok アプリの受信トレイに届き、人がアプリで仕上げて公開する）
//   - 状態:   POST /v2/post/publish/status/fetch/
// 未監査アプリは公開範囲 SELF_ONLY（自分のみ）でしか投稿できない。監査前は「下書き」モードで送り、人がアプリで公開する運用を推奨。
// AI で作った動画は post_info.is_aigc でラベルを付ける（アカウント設定の既定は「付ける」。投稿ごとに上書き可）。

import type { PlatformDefinition } from "../types";
import { ConfigError, expiresWithin, MINUTE, poll, request, requestJson, requireFields, tokenTimes } from "../http";

const API = "https://open.tiktokapis.com";
// video.upload は「下書き」モード（受信トレイへ送る）に必要。追加前に接続したアカウントは再接続すると使える
const SCOPES = ["user.info.basic", "video.publish", "video.upload"];


/** 投稿ごとの指定（空ならアカウント設定）で真偽を決める */
function flag(option: string | undefined, setting: unknown, fallback: boolean): boolean {
  if (option === "true" || option === "false") return option === "true";
  if (setting === "true" || setting === "false") return setting === "true";
  return fallback;
}
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
    {
      key: "disableDuet",
      label: "デュエット",
      type: "select",
      default: "false",
      options: [
        { value: "false", label: "許可" },
        { value: "true", label: "オフ" },
      ],
    },
    {
      key: "disableStitch",
      label: "リミックス（Stitch）",
      type: "select",
      default: "false",
      options: [
        { value: "false", label: "許可" },
        { value: "true", label: "オフ" },
      ],
    },
    {
      key: "aiGenerated",
      label: "AI 生成コンテンツのラベル",
      type: "select",
      default: "true",
      help: "AI で作った画像・動画を含む投稿は「付ける」にしてください（TikTok のガイドライン）",
      options: [
        { value: "true", label: "付ける" },
        { value: "false", label: "付けない" },
      ],
    },
    {
      key: "postMode",
      label: "送り方",
      type: "select",
      default: "direct",
      help: "監査前のアプリは「下書き」を推奨（TikTok アプリの受信トレイに届くので、アプリで確認して公開します）",
      options: [
        { value: "direct", label: "直接投稿（Direct Post）" },
        { value: "draft", label: "下書き（受信トレイへ送る）" },
      ],
    },
  ],
  postFields: [
    {
      key: "aiGenerated",
      label: "AI 生成ラベル",
      type: "select",
      options: [
        { value: "", label: "アカウント設定に従う" },
        { value: "true", label: "付ける" },
        { value: "false", label: "付けない" },
      ],
    },
  ],
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
    "「下書き」モードは video.upload 権限を使います。以前に接続したアカウントは再接続してください。",
    "TikTok のガイドラインにより、投稿前に公開範囲・コメント/デュエット/リミックスの可否を投稿者に示して同意を得る必要があります（動画パイプラインでは承認 D で確認します）。宣伝用のロゴや透かしは入れないでください。",
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
    if (!post.media.length) throw new ConfigError("TikTok: 動画または写真を添付してください");
    const video = post.media.find((m) => m.mimeType.startsWith("video/"));
    if (s.postMode === "draft") {
      if (!video) throw new ConfigError("TikTok: 下書きモードは動画のみ対応です");
      return uploadDraft(token, video);
    }
    // 投稿ごとの指定（動画パイプラインの承認 D で投稿者が選んだ設定）があればアカウント設定より優先する
    const privacyLevel = post.options.privacyLevel || s.privacyLevel;
    if (!privacyLevel) throw new ConfigError("TikTok: アカウント設定で公開範囲を選択してください");

    const creator = check(
      await requestJson("tiktok", `${API}/v2/post/publish/creator_info/query/`, { method: "POST", headers: authJson(token), json: {} }),
      "creator_info"
    );
    const allowed: string[] = creator?.privacy_level_options ?? [];
    if (allowed.length && !allowed.includes(privacyLevel)) {
      throw new ConfigError(`TikTok: 公開範囲 ${privacyLevel} はこのアカウントで使えません（選択肢: ${allowed.join(", ")}）`);
    }
    const disableComment = flag(post.options.disableComment, s.disableComment, false) || !!creator?.comment_disabled;
    const caption = post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text;
    const aigc = flag(post.options.aiGenerated, s.aiGenerated, true);

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
              privacy_level: privacyLevel,
              disable_comment: disableComment,
              disable_duet: flag(post.options.disableDuet, s.disableDuet, false) || !!creator?.duet_disabled,
              disable_stitch: flag(post.options.disableStitch, s.disableStitch, false) || !!creator?.stitch_disabled,
              video_cover_timestamp_ms: 1000,
              is_aigc: aigc,
            },
            source_info: { source: "FILE_UPLOAD", video_size: bytes.byteLength, chunk_size: chunkSize, total_chunk_count: count },
          },
        }),
        "video/init"
      );
      publishId = init.publish_id;
      await putChunks(init.upload_url, bytes, video.mimeType);
    } else {
      const init = check(
        await requestJson("tiktok", `${API}/v2/post/publish/content/init/`, {
          method: "POST",
          headers: authJson(token),
          json: {
            post_info: {
              title: (post.options.title || post.title || "").slice(0, 90),
              description: caption.slice(0, 4000),
              privacy_level: privacyLevel,
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

    const postId = await waitPublished(token, publishId, "PUBLISH_COMPLETE");
    const user = ctx.account.accountName.startsWith("@") ? ctx.account.accountName : "";
    const notes = [privacyLevel === "SELF_ONLY" ? "公開範囲「自分のみ」で投稿しました" : "", video && aigc ? "AI 生成ラベル付き" : ""].filter(Boolean);
    return {
      postId,
      url: user && postId !== publishId ? `https://www.tiktok.com/${user}/video/${postId}` : undefined,
      note: notes.length ? notes.join(" / ") : undefined,
    };
  },
};

async function putChunks(uploadUrl: string, bytes: Uint8Array, mimeType: string) {
  const { chunkSize, count } = tiktokChunks(bytes.byteLength);
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? bytes.byteLength : start + chunkSize;
    await request("tiktok", uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${bytes.byteLength}`,
      },
      body: bytes.subarray(start, end) as BodyInit,
    });
  }
}

/** 状態が done になるまで待つ。投稿 ID（公開された動画の ID が分かればそれ）を返す */
async function waitPublished(token: string, publishId: string, done: string): Promise<string> {
  return poll<string>(
    async () => {
      const st = check(
        await requestJson("tiktok", `${API}/v2/post/publish/status/fetch/`, { method: "POST", headers: authJson(token), json: { publish_id: publishId } }),
        "status/fetch"
      );
      if (st.status === "FAILED") return { done: false, error: st.fail_reason ?? "FAILED" };
      const ids = st.publicaly_available_post_id ?? st.publicly_available_post_id ?? [];
      return { done: st.status === done || st.status === "PUBLISH_COMPLETE", value: ids[0] ? String(ids[0]) : publishId };
    },
    { intervalMs: 5000, label: "TikTok の投稿処理" }
  );
}

/** 下書き: 受信トレイへ送る（公開範囲・ラベルは人が TikTok アプリで選ぶ） */
async function uploadDraft(token: string, video: { load: () => Promise<Uint8Array>; mimeType: string }) {
  const bytes = await video.load();
  const { chunkSize, count } = tiktokChunks(bytes.byteLength);
  const init = check(
    await requestJson("tiktok", `${API}/v2/post/publish/inbox/video/init/`, {
      method: "POST",
      headers: authJson(token),
      json: { source_info: { source: "FILE_UPLOAD", video_size: bytes.byteLength, chunk_size: chunkSize, total_chunk_count: count } },
    }),
    "inbox/video/init"
  );
  await putChunks(init.upload_url, bytes, video.mimeType);
  const postId = await waitPublished(token, init.publish_id, "SEND_TO_USER_INBOX");
  return { postId, note: "下書きとして TikTok の受信トレイに送りました（アプリで確認して公開してください。AI 生成ラベルもアプリで付けてください）" };
}
