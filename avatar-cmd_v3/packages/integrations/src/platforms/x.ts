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
//   - 引用:   元投稿の URL を本文に入れる（quote_tweet_id は自分の投稿・メンションされた投稿しか引用できないため使わない）
//   - 自分の投稿の反応: GET /2/tweets?ids=…&tweet.fields=public_metrics（指定した投稿だけ）
//   - ホームタイムライン: GET /2/users/{id}/timelines/reverse_chronological（返信・リポストを除外、投稿者情報なし）
//   - ユーザー情報: GET /2/users?ids=…（キャッシュして 1〜7 日に 1 回まで）
//   料金（従量課金・2026-10 時点）: Post Read 1件 $0.005 / User Read 1件 $0.010 / Post Create 1回 $0.015。
//   読み取りの回数・件数はアバターごとの X API の利用方針（service/x-policy.ts）で決める

import type { MediaFile, PlatformDefinition, PostMetrics, PublishContext, TimelinePost } from "../types";
import { ApiError, basicAuth, ConfigError, expiresWithin, MINUTE, poll, requestJson, requireFields, tokenTimes, withQuery } from "../http";
import { appendInlineQuote, canonicalStatusUrl, formatPostText, INLINE_QUOTE_WEIGHT, LONG_POST_MODE_FIELD, longPostMode, stripQuoteUrl, xLength, xPostLimit } from "../post-text";

const API = "https://api.x.com";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const CHUNK = 2 * 1024 * 1024; // append 1回あたりのバイト数（base64化前）

function bearer(ctx: PublishContext): Record<string, string> {
  const token = ctx.credentials.accessToken;
  if (!token) throw new ConfigError("X: アカウントを再接続してください（アクセストークンなし）");
  return { Authorization: `Bearer ${token}` };
}

function readError(e: unknown): never {
  if (e instanceof ApiError && e.status === 402) throw new ConfigError(`X: API クレジットが不足しています (${e.body.slice(0, 200)})`);
  throw e;
}

/**
 * 投稿の失敗を、原因と対処がわかる設定エラーにする。
 * 設定で直せないもの（429・5xx など）はそのまま投げて再試行させる
 */
function postError(e: unknown): never {
  if (!(e instanceof ApiError)) throw e;
  const body = e.body.slice(0, 200);
  const lower = e.body.toLowerCase();
  if (e.status === 402) throw new ConfigError(`X: API クレジット/プランが不足しています。アバター専用アプリの場合は、そのアプリの開発者アカウント側にクレジットが必要です (${body})`);
  if (e.status === 401) throw new ConfigError(`X: 認証に失敗しました。アカウントを再接続してください（アプリの Client ID/Secret を変更した場合も再接続が必要です） (${body})`);
  if (lower.includes("too long") || lower.includes("text is too long")) {
    throw new ConfigError(`X: 文字数が上限を超えています。X Premium でないアカウントは日本語で約140文字までです。アカウント設定の「X Premium」を確認してください (${body})`);
  }
  if (lower.includes("duplicate")) throw new ConfigError(`X: 直前と同じ内容の投稿は拒否されます (${body})`);
  if (e.status === 403 && (lower.includes("oauth1-permissions") || lower.includes("not permitted") || lower.includes("unsupported-authentication"))) {
    throw new ConfigError(`X: アプリの権限が不足しています。App permissions を「Read and write」にしたうえで再接続してください (${body})`);
  }
  throw e;
}

function toMetrics(m: Record<string, number> | undefined): PostMetrics {
  if (!m) return {};
  return {
    views: m.impression_count,
    likes: m.like_count,
    replies: m.reply_count,
    reposts: m.retweet_count,
    quotes: m.quote_count,
    bookmarks: m.bookmark_count,
  };
}

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
  settingFields: [
    LONG_POST_MODE_FIELD,
    {
      key: "premium",
      label: "X Premium（長文投稿）",
      type: "select",
      default: "off",
      options: [
        { value: "off", label: "なし（1件 280＝日本語 約140文字まで）" },
        { value: "on", label: "あり（長文を1件で投稿できる）" },
      ],
      help: "Premium でないアカウントは日本語で約140文字を超えると投稿できないため、超える分は自動でツリーに分けます",
    },
    {
      key: "quoteScanHours",
      label: "引用候補の自動探索（ホームタイムライン）",
      type: "select",
      default: "off",
      options: [
        { value: "off", label: "しない（手動のみ）" },
        { value: "on", label: "する（アバターの X API モードの時刻に探索）" },
      ],
      help: "フォロー中の投稿から、方向性が同じ投稿の引用案を下書きに作ります（投稿は必ず承認制）。時刻・読む件数はアバター > X API のモードで決まります",
    },
  ],
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

    // 引用（X）は最初から「元投稿の URL を本文に入れる」方式（quote_tweet_id は使わない。失敗時の切り替えもしない）
    const quoteUrl = post.quotePostUrl || post.quotePostId ? canonicalStatusUrl(post.quotePostUrl, post.quotePostId) : null;
    if ((post.quotePostUrl || post.quotePostId) && !quoteUrl) throw new ConfigError(`X: 引用する投稿の URL が不正です (${post.quotePostUrl ?? post.quotePostId})`);
    // 200文字以内は改行なし、超える場合は設定に従って改行あり1件 or ツリー（上限を超えるなら必ずツリー）
    const base = post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text;
    const full = quoteUrl ? stripQuoteUrl(base, quoteUrl.split("/").at(-1)!) : base;
    // 整形（改行の除去・ツリー分割）は URL を入れる前に行い、URL ぶん（前後のスペース含む）の長さを空けておく
    const limit = xPostLimit(ctx.settings) - (quoteUrl ? INLINE_QUOTE_WEIGHT : 0);
    const parts = formatPostText(full, { mode: longPostMode(ctx.settings), limit, measure: xLength });
    if (quoteUrl) parts[0] = appendInlineQuote(parts[0], quoteUrl);

    const mediaIds: string[] = [];
    for (const m of post.media.slice(0, 4)) mediaIds.push(await uploadMedia(token, m));

    const body: Record<string, unknown> = { text: parts[0] };
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    const send = (json: Record<string, unknown>) =>
      requestJson("x", `${API}/2/tweets`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, json });
    const d = await send(body).catch(postError);
    const username = (ctx.credentials.username as string) || ctx.account.accountName.replace(/^@/, "");
    const first: string = d.data.id;

    // ツリーの2件目以降は直前の投稿への返信。1件目は投稿済みなので、失敗しても全体は失敗にしない（再試行で重複させない）
    let prev = first;
    for (let i = 1; i < parts.length; i++) {
      try {
        const r = await send({ text: parts[i], reply: { in_reply_to_tweet_id: prev } }).catch(postError);
        prev = r.data.id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { postId: first, url: `https://x.com/${username}/status/${first}`, note: `ツリー ${i + 1}/${parts.length} 件目以降の投稿に失敗: ${msg.slice(0, 200)}` };
      }
    }
    return {
      postId: first,
      url: `https://x.com/${username}/status/${first}`,
      ...(parts.length > 1 ? { note: `ツリー投稿（${parts.length}件）` } : {}),
    };
  },
  supportsQuote: true,
  async fetchProfile(ctx) {
    const d = await requestJson("x", withQuery(`${API}/2/users/me`, { "user.fields": "public_metrics,profile_image_url" }), { headers: bearer(ctx) }).catch(readError);
    const m = (d.data?.public_metrics ?? {}) as Record<string, number>;
    // profile_image_url は 48px（_normal）。_400x400 に置き換えると同じ画像の大きいサイズになる
    const image = typeof d.data?.profile_image_url === "string" ? d.data.profile_image_url.replace(/_normal(\.\w+)$/, "_400x400$1") : undefined;
    return { followers: m.followers_count, following: m.following_count, posts: m.tweet_count, imageUrl: image };
  },
  async fetchMetrics(ctx, posts) {
    // 指定した投稿だけを読む（GET /2/tweets?ids=、100 件ずつ）。読み取りの課金は返ってきた投稿の数だけ。
    // 以前は自分の投稿一覧（/2/users/{id}/tweets）を読み直していたため、必要のない投稿にも課金されていた
    const found: Record<string, PostMetrics | { error: string }> = {};
    const ids = [...new Set(posts.map((p) => p.postId))];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const d = await requestJson("x", withQuery(`${API}/2/tweets`, { ids: chunk.join(","), "tweet.fields": "public_metrics" }), { headers: bearer(ctx) }).catch(readError);
      for (const t of (d.data ?? []) as { id: string; public_metrics?: Record<string, number> }[]) found[t.id] = toMetrics(t.public_metrics);
      for (const e of (d.errors ?? []) as { resource_id?: string; value?: string; title?: string; detail?: string }[]) {
        const id = e.resource_id ?? e.value;
        if (id && !found[id]) found[id] = { error: e.title === "Not Found Error" ? "投稿が見つかりません（削除済みの可能性）" : (e.detail ?? e.title ?? "取得できませんでした") };
      }
    }
    for (const id of ids) if (!found[id]) found[id] = { error: "投稿が見つかりません（削除済みの可能性）" };
    return found;
  },
  async lookupUsers(ctx, ids) {
    const out: { id: string; username: string; name?: string; followers?: number }[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const d = await requestJson("x", withQuery(`${API}/2/users`, { ids: ids.slice(i, i + 100).join(","), "user.fields": "username,name,public_metrics" }), { headers: bearer(ctx) }).catch(readError);
      for (const u of (d.data ?? []) as { id: string; username: string; name?: string; public_metrics?: { followers_count?: number } }[]) {
        out.push({ id: u.id, username: u.username, name: u.name, followers: u.public_metrics?.followers_count });
      }
    }
    return out;
  },
  async fetchTimeline(ctx, opts) {
    const uid = ctx.account.accountId;
    const d = await requestJson(
      "x",
      withQuery(`${API}/2/users/${uid}/timelines/reverse_chronological`, {
        max_results: String(Math.min(Math.max(opts.maxResults, 1), 100)),
        // 返信・リポストは最初から返させない（読んでから捨てる分にも課金されるため）
        exclude: "replies,retweets",
        since_id: opts.sinceId,
        "tweet.fields": "created_at,public_metrics,author_id,lang,referenced_tweets",
        // 投稿者情報（expansions=author_id）は付けない。ユーザー情報は User Read として高く課金される可能性があるため、
        // 引用案の候補に残った投稿の投稿者だけをキャッシュ経由で引く（quotes.ts）
      }),
      { headers: bearer(ctx) }
    ).catch(readError);
    return ((d.data ?? []) as { id: string; text: string; author_id?: string; created_at?: string; lang?: string; public_metrics?: Record<string, number>; referenced_tweets?: { type: string }[] }[]).map((t): TimelinePost => {
      const ref = t.referenced_tweets?.[0]?.type;
      return {
        id: t.id,
        text: t.text,
        url: `https://x.com/i/web/status/${t.id}`,
        authorId: t.author_id,
        createdAt: t.created_at,
        lang: t.lang,
        metrics: toMetrics(t.public_metrics),
        kind: ref === "retweeted" ? "repost" : ref === "replied_to" ? "reply" : ref === "quoted" ? "quote" : "original",
      };
    });
  },
};
