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
//   - 引用:   POST /2/tweets { quote_tweet_id }
//   - 自分の投稿の反応: GET /2/users/{id}/tweets?tweet.fields=public_metrics
//   - ホームタイムライン: GET /2/users/{id}/timelines/reverse_chronological
//   料金（従量課金）: 上の2つは「Owned Reads」で 1件 $0.001（認証ユーザー＝開発者アプリの所有者のとき）。
//   それ以外のアプリで認証した場合は通常の読み取り（1件 $0.005）。→ アバター専用アプリの利用を推奨

import type { MediaFile, PlatformDefinition, PostMetrics, PublishContext, TimelinePost } from "../types";
import { ApiError, basicAuth, ConfigError, expiresWithin, MINUTE, poll, requestJson, requireFields, tokenTimes, withQuery } from "../http";

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
    {
      key: "quoteScanHours",
      label: "引用候補の自動探索（ホームタイムライン）",
      type: "select",
      default: "off",
      options: [
        { value: "off", label: "しない（手動のみ）" },
        { value: "12", label: "12時間ごと" },
        { value: "24", label: "24時間ごと" },
      ],
      help: "フォロー中の投稿から、方向性が同じ投稿の引用案を下書きに作ります（投稿は必ず承認制）",
    },
    {
      key: "quoteScanPosts",
      label: "1回に読むタイムライン件数",
      type: "select",
      default: "30",
      options: [
        { value: "20", label: "20件" },
        { value: "30", label: "30件" },
        { value: "50", label: "50件" },
        { value: "100", label: "100件" },
      ],
      help: "Owned Reads なら1件 $0.001（30件で約 $0.03）。このアカウントで作った開発者アプリ（アバター専用アプリ）で接続したときの料金です",
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
    const mediaIds: string[] = [];
    for (const m of post.media.slice(0, 4)) mediaIds.push(await uploadMedia(token, m));

    const body: Record<string, unknown> = { text: post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text };
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    if (post.quotePostId) body.quote_tweet_id = post.quotePostId;
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
  supportsQuote: true,
  async fetchMetrics(ctx, posts) {
    if (!posts.length) return {};
    const uid = ctx.account.accountId;
    const want = new Set(posts.map((p) => p.postId));
    const oldest = Math.min(...posts.map((p) => p.publishedAt.getTime()));
    const found: Record<string, PostMetrics | { error: string }> = {};
    let token: string | undefined;
    // 自分の投稿を新しい順に最大3ページ（300件）。対象がすべて見つかれば打ち切る（課金を抑える）
    for (let page = 0; page < 3 && want.size; page++) {
      const d = await requestJson(
        "x",
        withQuery(`${API}/2/users/${uid}/tweets`, {
          max_results: "100",
          "tweet.fields": "public_metrics,created_at",
          start_time: new Date(oldest - 60_000).toISOString(),
          pagination_token: token,
        }),
        { headers: bearer(ctx) }
      ).catch(readError);
      for (const t of (d.data ?? []) as { id: string; public_metrics?: Record<string, number> }[]) {
        if (!want.has(t.id)) continue;
        found[t.id] = toMetrics(t.public_metrics);
        want.delete(t.id);
      }
      token = d.meta?.next_token;
      if (!token) break;
    }
    for (const id of want) found[id] = { error: "自分の投稿一覧に見つかりません（削除済みの可能性）" };
    return found;
  },
  async fetchTimeline(ctx, opts) {
    const uid = ctx.account.accountId;
    const d = await requestJson(
      "x",
      withQuery(`${API}/2/users/${uid}/timelines/reverse_chronological`, {
        max_results: String(Math.min(Math.max(opts.maxResults, 1), 100)),
        exclude: "replies",
        since_id: opts.sinceId,
        "tweet.fields": "created_at,public_metrics,author_id,lang,referenced_tweets",
        expansions: "author_id",
        "user.fields": "username,name",
      }),
      { headers: bearer(ctx) }
    ).catch(readError);
    const users = new Map<string, { username: string; name: string }>(((d.includes?.users ?? []) as { id: string; username: string; name: string }[]).map((u) => [u.id, u]));
    return ((d.data ?? []) as { id: string; text: string; author_id?: string; created_at?: string; lang?: string; public_metrics?: Record<string, number>; referenced_tweets?: { type: string }[] }[]).map((t): TimelinePost => {
      const u = t.author_id ? users.get(t.author_id) : undefined;
      const ref = t.referenced_tweets?.[0]?.type;
      return {
        id: t.id,
        text: t.text,
        url: `https://x.com/${u?.username ?? "i/web"}/status/${t.id}`,
        authorId: t.author_id,
        authorUsername: u?.username,
        authorName: u?.name,
        createdAt: t.created_at,
        lang: t.lang,
        metrics: toMetrics(t.public_metrics),
        kind: ref === "retweeted" ? "repost" : ref === "replied_to" ? "reply" : ref === "quoted" ? "quote" : "original",
      };
    });
  },
};
