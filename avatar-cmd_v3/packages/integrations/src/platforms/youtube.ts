// ================================================
// YouTube — YouTube Data API v3（動画アップロード）
// ================================================
// 公式: https://developers.google.com/youtube/v3/docs/videos/insert
//   - 認可:   https://accounts.google.com/o/oauth2/v2/auth（access_type=offline, PKCE S256）
//   - トークン: POST https://oauth2.googleapis.com/token
//   - 投稿:   POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//             → Location の URL に動画バイト列を PUT（再開可能アップロード）
//   - 予約公開: status.privacyStatus=private + status.publishAt（ISO 8601）
//   - サムネイル: POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=...（画像を添付したとき）
//   - 字幕:   POST https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart（SRT。youtube.force-ssl 権限）
// 公開は人の承認後だけにするため、公開設定の既定は「非公開」。予約公開日時を指定したときは必ず非公開でアップロードする。
// アップロード後のサムネイル・字幕の失敗では投稿を失敗にしない（失敗にすると再送で同じ動画が二重に上がるため）。結果の note に残す。

import type { MediaFile, PlatformDefinition } from "../types";
import { ApiError, ConfigError, expiresWithin, MINUTE, request, requestJson, requireFields, tokenTimes, deriveTitle } from "../http";

// youtube.force-ssl は字幕（captions.insert）の登録に必要。追加前に接続したアカウントは再接続すると字幕も登録できる
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"];
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

/** 予約公開日時を検証して ISO 文字列にする（未指定は null） */
export function parsePublishAt(raw: string | undefined, now = new Date()): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ConfigError(`YouTube: 予約公開日時を読めません: ${v}（例: 2026-10-10T19:00:00+09:00）`);
  if (d.getTime() <= now.getTime()) throw new ConfigError("YouTube: 予約公開日時が過去です。未来の日時を指定してください");
  return d.toISOString();
}

/** multipart/related の本文（メタデータ JSON + ファイル）を作る */
function multipartRelated(metadata: unknown, body: Uint8Array, mimeType: string): { body: Uint8Array; contentType: string } {
  const boundary = `avatarcmd${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(head.byteLength + body.byteLength + tail.byteLength);
  out.set(head, 0);
  out.set(body, head.byteLength);
  out.set(tail, head.byteLength + body.byteLength);
  return { body: out, contentType: `multipart/related; boundary=${boundary}` };
}

async function setThumbnail(token: string, videoId: string, image: MediaFile) {
  const bytes = await image.load();
  await request("youtube", `${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": image.mimeType },
    body: bytes as BodyInit,
  });
}

async function insertCaptions(token: string, videoId: string, srt: string, language: string) {
  const m = multipartRelated({ snippet: { videoId, language, name: language === "ja" ? "日本語" : language, isDraft: false } }, new TextEncoder().encode(srt), "application/octet-stream");
  await request("youtube", `${UPLOAD}/captions?part=snippet&uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": m.contentType },
    body: m.body as BodyInit,
  });
}

function shortError(e: unknown): string {
  if (e instanceof ApiError) return e.status === 403 ? "権限がありません（アカウントを再接続してください）" : `${e.status} ${e.body.slice(0, 120)}`;
  return e instanceof Error ? e.message.slice(0, 120) : String(e);
}
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
      default: "private",
      help: "既定は非公開（公開は承認後に予約公開か YouTube Studio で）。予約公開日時を指定した投稿は、この設定にかかわらず非公開でアップロードします",
      options: [
        { value: "private", label: "非公開（推奨）" },
        { value: "unlisted", label: "限定公開" },
        { value: "public", label: "公開" },
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
  postFields: [
    { key: "title", label: "動画タイトル（100文字まで）" },
    { key: "publishAt", label: "予約公開日時（任意）", placeholder: "2026-10-10T19:00:00+09:00", help: "指定すると非公開でアップロードし、この日時に自動で公開されます" },
  ],
  // 画像を 1 枚添付するとサムネイルに設定する
  media: { image: true, video: true, required: "video", maxCount: 2 },
  docs: [
    { label: "videos.insert", url: "https://developers.google.com/youtube/v3/docs/videos/insert" },
    { label: "thumbnails.set", url: "https://developers.google.com/youtube/v3/docs/thumbnails/set" },
    { label: "captions.insert", url: "https://developers.google.com/youtube/v3/docs/captions/insert" },
    { label: "OAuth 2.0 (Web サーバー)", url: "https://developers.google.com/identity/protocols/oauth2/web-server" },
  ],
  notes: [
    "Google Cloud Console で「YouTube Data API v3」を有効化し、OAuth 同意画面を設定、承認済みリダイレクトURIに下記URIを登録してください。",
    "未監査の API プロジェクトからアップロードした動画は「非公開」に固定されます。公開するには YouTube API サービスの監査申請が必要です。",
    "既定のクォータは 1 日 10,000 ユニット、動画アップロードは 1 回 1,600 ユニットです（上限は Google Cloud Console で確認）。",
    "画像を 1 枚添付するとサムネイルに設定します（カスタムサムネイルはチャンネルの電話番号確認が必要）。字幕（SRT）の登録には youtube.force-ssl 権限が必要なため、以前に接続したアカウントは再接続してください。",
    "「改変・合成されたコンテンツ」の開示は API では設定できないため、該当する動画は YouTube Studio で設定してください。",
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
    const d = await requestJson("youtube", "https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true", { headers: { Authorization: `Bearer ${token}` } });
    const st = d.items?.[0]?.statistics as { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean } | undefined;
    const n = (v?: string) => (v === undefined ? undefined : Number(v));
    const thumbs = d.items?.[0]?.snippet?.thumbnails as Record<string, { url?: string }> | undefined;
    return { followers: st?.hiddenSubscriberCount ? undefined : n(st?.subscriberCount), posts: n(st?.videoCount), imageUrl: thumbs?.high?.url ?? thumbs?.medium?.url ?? thumbs?.default?.url };
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    if (!token) throw new ConfigError("YouTube: アカウントを再接続してください");
    const video = post.media.find((m) => m.mimeType.startsWith("video/"));
    if (!video) throw new ConfigError("YouTube: 動画ファイルを添付してください");
    const thumbnail = post.media.find((m) => m.mimeType.startsWith("image/"));
    const s = ctx.settings as Record<string, string>;
    const title = deriveTitle({ title: post.options.title || post.title, text: post.text }, 100).replace(/[<>]/g, "");
    const description = (post.link && !post.text.includes(post.link) ? `${post.text}\n\n${post.link}` : post.text).replace(/[<>]/g, "");
    const publishAt = parsePublishAt(post.options.publishAt);
    // 予約公開は非公開でしか受け付けられない。指定が無いときも既定は非公開（公開は人の承認後だけ）
    const privacyStatus = publishAt ? "private" : s.privacyStatus || "private";

    const bytes = await video.load();
    const init = await request("youtube", `${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Upload-Content-Length": String(bytes.byteLength),
        "X-Upload-Content-Type": video.mimeType,
      },
      json: {
        snippet: { title, description: description.slice(0, 5000), tags: post.tags?.slice(0, 30), categoryId: s.categoryId || "22", defaultLanguage: post.options.language || "ja" },
        status: { privacyStatus, ...(publishAt ? { publishAt } : {}), selfDeclaredMadeForKids: (post.options.madeForKids || s.madeForKids) === "true" },
      },
    });
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube: アップロードURLが返されませんでした");
    const d = await requestJson("youtube", uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": video.mimeType },
      body: bytes as BodyInit,
    });

    // ここから先の失敗では投稿を失敗にしない（再送で動画が二重に上がるのを防ぐ）
    const notes: string[] = [publishAt ? `非公開でアップロードし、${new Date(publishAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} に公開予約しました` : `公開設定: ${privacyStatus}`];
    if (thumbnail) {
      await setThumbnail(token, d.id, thumbnail).then(
        () => notes.push("サムネイルを設定しました"),
        (e) => notes.push(`サムネイルの設定に失敗: ${shortError(e)}`)
      );
    }
    if (post.options.captionsSrt?.trim()) {
      await insertCaptions(token, d.id, post.options.captionsSrt, post.options.language || "ja").then(
        () => notes.push("字幕を登録しました"),
        (e) => notes.push(`字幕の登録に失敗: ${shortError(e)}`)
      );
    }
    return { postId: d.id, url: `https://www.youtube.com/watch?v=${d.id}`, note: notes.join(" / ") };
  },
};
