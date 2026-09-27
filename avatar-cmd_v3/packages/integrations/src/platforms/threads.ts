// ================================================
// Threads — Threads API (graph.threads.net)
// ================================================
// 公式: https://developers.facebook.com/docs/threads
//   - 認可:     https://threads.net/oauth/authorize
//   - 短期トークン: POST https://graph.threads.net/oauth/access_token
//   - 長期トークン: GET  https://graph.threads.net/access_token?grant_type=th_exchange_token  (60日)
//   - 更新:     GET  https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token
//   - 投稿:     POST /v1.0/{user-id}/threads（コンテナ作成）→ POST /v1.0/{user-id}/threads_publish
//   - テキスト上限 500 文字 / カルーセル最大 20 件

import type { MediaFile, PlatformDefinition } from "../types";
import { ConfigError, DAY, expiresWithin, olderThan, poll, requestJson, requireFields, tokenTimes, withQuery } from "../http";

const GRAPH = "https://graph.threads.net";
const V = "v1.0";
const SCOPES = ["threads_basic", "threads_content_publish"];

async function createContainer(uid: string, token: string, params: Record<string, string>): Promise<string> {
  const d = await requestJson("threads", `${GRAPH}/${V}/${uid}/threads`, {
    method: "POST",
    form: { ...params, access_token: token },
  });
  return d.id;
}

async function waitReady(id: string, token: string) {
  await poll(
    async () => {
      const s = await requestJson("threads", withQuery(`${GRAPH}/${V}/${id}`, { fields: "status,error_message", access_token: token }));
      if (s.status === "ERROR" || s.status === "EXPIRED") return { done: false, error: s.error_message || s.status };
      return { done: s.status === "FINISHED" || s.status === "PUBLISHED" };
    },
    { intervalMs: 3000, label: "Threads のメディア処理" }
  );
}

function mediaParams(m: MediaFile): Record<string, string> {
  return m.mimeType.startsWith("video/")
    ? { media_type: "VIDEO", video_url: m.url }
    : { media_type: "IMAGE", image_url: m.url, ...(m.alt ? { alt_text: m.alt } : {}) };
}

export const threads: PlatformDefinition = {
  id: "threads",
  name: "Threads",
  icon: "🧵",
  support: "official",
  connection: "oauth",
  maxLength: 500,
  appFields: [
    { key: "appId", label: "Threads App ID", required: true, help: "Meta アプリの「Threads API」ユースケースに表示される Threads App ID" },
    { key: "appSecret", label: "Threads App Secret", type: "password", required: true },
  ],
  accountFields: [],
  settingFields: [],
  postFields: [],
  media: { image: true, video: true, maxCount: 20 },
  docs: [
    { label: "Threads API", url: "https://developers.facebook.com/docs/threads" },
    { label: "投稿 (Publishing)", url: "https://developers.facebook.com/docs/threads/posts" },
  ],
  notes: [
    "Meta for Developers でアプリを作成し、ユースケース「Threads API にアクセス」を追加してください。",
    "権限 threads_basic / threads_content_publish を追加し、リダイレクトコールバックURLに下記URIを登録します。",
    "アプリが開発モードの間は、Threads テスターに追加したアカウントのみ接続できます。",
    "画像・動画は公開URLから取り込まれるため、公開URL（システム設定）が外部から到達可能である必要があります。",
  ],
  oauth: {
    pkce: false,
    authorizeUrl(app, p) {
      requireFields("Threads", app, ["appId", "appSecret"], "API連携アプリ");
      const q = new URLSearchParams({
        client_id: app.appId,
        redirect_uri: p.redirectUri,
        scope: SCOPES.join(","),
        response_type: "code",
        state: p.state,
      });
      return `https://threads.net/oauth/authorize?${q}`;
    },
    async exchangeCode(app, p) {
      const short = await requestJson("threads", `${GRAPH}/oauth/access_token`, {
        method: "POST",
        form: {
          client_id: app.appId,
          client_secret: app.appSecret,
          grant_type: "authorization_code",
          redirect_uri: p.redirectUri,
          code: p.code,
        },
      });
      const long = await requestJson(
        "threads",
        withQuery(`${GRAPH}/access_token`, { grant_type: "th_exchange_token", client_secret: app.appSecret, access_token: short.access_token })
      );
      const me = await requestJson("threads", withQuery(`${GRAPH}/${V}/me`, { fields: "id,username", access_token: long.access_token }));
      return [
        {
          accountId: String(me.id),
          accountName: `@${me.username}`,
          profileUrl: `https://www.threads.com/@${me.username}`,
          credentials: { accessToken: long.access_token, userId: String(me.id), ...tokenTimes(long.expires_in) },
          scopes: SCOPES.join(","),
        },
      ];
    },
  },
  async refresh(_app, cred) {
    // 長期トークンは発行から24時間以降・失効前に更新可能。残り7日を切ったら更新する
    if (!cred.accessToken || !expiresWithin(cred.expiresAt, 7 * DAY) || !olderThan(cred.issuedAt, DAY)) return null;
    const d = await requestJson(
      "threads",
      withQuery(`${GRAPH}/refresh_access_token`, { grant_type: "th_refresh_token", access_token: cred.accessToken })
    );
    return { ...cred, accessToken: d.access_token, ...tokenTimes(d.expires_in) };
  },
  async publish(ctx, post) {
    const token = ctx.credentials.accessToken;
    const uid = (ctx.credentials.userId as string) || ctx.account.accountId;
    if (!token) throw new ConfigError("Threads: アカウントを再接続してください");
    const text = post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text;

    let creationId: string;
    if (post.media.length === 0) {
      creationId = await createContainer(uid, token, { media_type: "TEXT", text });
    } else if (post.media.length === 1) {
      creationId = await createContainer(uid, token, { ...mediaParams(post.media[0]), text });
      await waitReady(creationId, token);
    } else {
      const children: string[] = [];
      for (const m of post.media.slice(0, 20)) {
        const id = await createContainer(uid, token, { ...mediaParams(m), is_carousel_item: "true" });
        await waitReady(id, token);
        children.push(id);
      }
      creationId = await createContainer(uid, token, { media_type: "CAROUSEL", children: children.join(","), text });
      await waitReady(creationId, token);
    }

    const pub = await requestJson("threads", `${GRAPH}/${V}/${uid}/threads_publish`, {
      method: "POST",
      form: { creation_id: creationId, access_token: token },
    });
    const info = await requestJson("threads", withQuery(`${GRAPH}/${V}/${pub.id}`, { fields: "permalink", access_token: token })).catch(() => ({}));
    return { postId: String(pub.id), url: (info as any).permalink };
  },
};
