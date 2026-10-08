// ================================================
// note — 公開APIなし。ログインセッションで「公開の直前」まで行う
// ================================================
// note.com は公式の投稿APIを提供していない。ここでは note の Web エディタが使う
// エンドポイント（非公式）にログイン Cookie で下書きを作成する。
//   - GET  https://note.com/api/v2/current_user            ログイン確認・フォロワー数
//   - POST https://note.com/api/v1/text_notes               空の下書きを作成 → { id, key }
//   - POST https://note.com/api/v3/images/upload/presigned_post 本文の画像（multipart: filename）
//          → { action, post: {S3 のフォーム項目}, url } → action（S3）へ post の項目 + file を送ると url で使える
//          （note の画像置き場 assets.st-note.com に入る。note のエディタと同じ 2 段階の方式）
//   - POST https://note.com/api/v1/upload_image             旧方式（multipart: file → URL）。上が使えないときだけ使う
//   - POST https://note.com/api/v1/image_upload/note_eyecatch 見出し画像（multipart: note_id, file, width, height）
//   - POST https://note.com/api/v1/text_notes/draft_save?id= 本文・タグ・有料ライン（separator）・価格を保存
//   - GET  https://note.com/api/v1/stats/pv                 記事ごとの累計 PV・スキ（閲覧数の推移に使う）
// 公開（取り消せない操作）だけは行わない。有料ライン・価格・画像・タグは下書きに入れ、公開ボタンは本人が押す。
// 画像や有料設定が受け付けられなかった場合も本文の下書きは保存し、何が入らなかったかを返す。
// 仕様変更で動かなくなる可能性がある。

import type { AccountInsights, MediaFile, PlatformDefinition } from "../types";
import { ApiError, ConfigError, deriveTitle, request, requestJson, requireFields } from "../http";
import { htmlTextLength, markdownImageSources, markdownToNote } from "../markdown";

const API = "https://note.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
/** note の有料記事の価格（円）。note の仕様: 100〜50,000 円 */
const NOTE_PRICE_MIN = 100;
const NOTE_PRICE_MAX = 50_000;

function noteCookie(raw: string): string {
  const v = raw.trim();
  return v.includes("=") ? v : `_note_session_v5=${v}`;
}

function headers(cookie: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UA,
    "X-Requested-With": "XMLHttpRequest",
    Cookie: cookie,
  };
  const xsrf = cookie.match(/XSRF-TOKEN=([^;]+)/);
  if (xsrf) h["X-XSRF-TOKEN"] = decodeURIComponent(xsrf[1]);
  return h;
}

function authError(e: unknown): never {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
    throw new ConfigError("note: ログインセッションが切れています。Cookie（_note_session_v5）を取り直して再接続してください");
  }
  throw e;
}

async function call(cookie: string, path: string, init: { method?: string; json?: unknown } = {}) {
  try {
    return await requestJson("note", API + path, { method: init.method ?? "GET", headers: headers(cookie), json: init.json, redirect: "manual" });
  } catch (e) {
    authError(e);
  }
}

async function upload(cookie: string, path: string, file: MediaFile, fields: Record<string, string> = {}): Promise<string> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([Buffer.from(await file.load())], { type: file.mimeType }), file.filename);
  let res: Response;
  try {
    res = await request("note", API + path, { method: "POST", headers: headers(cookie), body: form, redirect: "manual" });
  } catch (e) {
    authError(e);
  }
  const d = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown> };
  const url = d.data?.url ?? d.data?.image_url ?? d.data?.eyecatch_url;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new Error("note: 画像の URL が返りませんでした");
  return url;
}

/**
 * 本文の画像を note の画像置き場にアップロードし、本文に埋め込む URL を返す。
 * note のエディタと同じ 2 段階（presigned_post で S3 の送り先を受け取る → S3 へ直接送る）。
 * presigned_post が使えない（仕様変更など）ときは旧方式の upload_image を試す。
 */
async function uploadBodyImage(cookie: string, file: MediaFile): Promise<string> {
  let presigned: { action?: unknown; post?: Record<string, unknown>; url?: unknown } | undefined;
  try {
    const form = new FormData();
    form.append("filename", file.filename);
    const res = await request("note", `${API}/v3/images/upload/presigned_post`, { method: "POST", headers: headers(cookie), body: form, redirect: "manual" });
    presigned = ((await res.json().catch(() => ({}))) as { data?: typeof presigned }).data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) authError(e);
    presigned = undefined;
  }
  const action = typeof presigned?.action === "string" ? presigned.action : "";
  const url = typeof presigned?.url === "string" ? presigned.url : "";
  if (!/^https:\/\//.test(action) || !/^https:\/\//.test(url) || !presigned?.post || !Object.keys(presigned.post).length) {
    return upload(cookie, "/v1/upload_image", file);
  }
  // S3 の POST ポリシー: 受け取った項目をすべて送り、file を最後に置く。S3 には Cookie を送らない
  const s3 = new FormData();
  for (const [k, v] of Object.entries(presigned.post)) if (v !== null && v !== undefined && v !== "") s3.append(k, String(v));
  s3.append("file", new Blob([Buffer.from(await file.load())], { type: file.mimeType }), file.filename);
  await request("note", action, { method: "POST", body: s3 });
  return url;
}

/** 本文の参照先（media:{name} / /media/{name} / 公開 URL）から添付ファイルを探す */
function findMedia(media: MediaFile[], src: string): MediaFile | undefined {
  const name = src.replace(/^media:/, "").split("/").pop() ?? "";
  return media.find((m) => m.url === src || (name && m.url.endsWith(`/media/${name}`)));
}

/** 価格の検証。空・0 は無料（null） */
export function notePrice(raw: string | undefined): number | null {
  const v = String(raw ?? "").replace(/[,，¥円\s]/g, "");
  if (!v || v === "0") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < NOTE_PRICE_MIN || n > NOTE_PRICE_MAX) throw new ConfigError(`note: 価格は ${NOTE_PRICE_MIN}〜${NOTE_PRICE_MAX.toLocaleString()} 円の整数で入力してください`);
  return n;
}

export const note: PlatformDefinition = {
  id: "note",
  name: "note",
  icon: "📝",
  support: "unofficial",
  connection: "credentials",
  maxLength: 140_000,
  appFields: [],
  accountFields: [
    {
      key: "cookie",
      label: "ログインCookie（_note_session_v5）",
      type: "password",
      required: true,
      help: "PCのChromeでnote.comにログイン → F12 → Application → Cookies → https://note.com → _note_session_v5 の値",
    },
  ],
  settingFields: [],
  postFields: [
    { key: "title", label: "記事タイトル" },
    { key: "price", label: "価格（円・有料記事のみ）", placeholder: "例: 500（空なら無料）", help: "本文の <!-- paywall --> の位置から有料になります。公開は note の編集画面で行います" },
    { key: "eyecatch", label: "見出し画像（添付ファイル名）", help: "記事エディタで選ぶと自動で入ります" },
  ],
  media: { image: true, video: false, maxCount: 40 },
  docs: [{ label: "note ヘルプ", url: "https://www.help-note.com/hc/ja" }],
  notes: [
    "note には公開APIがないため、ログインCookieを使って下書きに本文・画像・見出し画像・タグ・有料ライン・価格まで入れます。公開ボタンは note の編集画面で押してください。",
    "有料ラインは本文に <!-- paywall --> と書いた位置に入ります。価格を入れずに有料ラインだけ書いた場合は無料記事として保存します。",
    "Cookie はログアウトすると無効になります。期限切れのエラーが出たら取り直して再接続してください。",
    "非公式の仕組みのため、note 側の変更で画像・有料設定が入らなくなる場合があります。その場合も本文は保存し、入らなかった項目をお知らせします。",
  ],
  async connect(_app, input) {
    requireFields("note", input, ["cookie"], "アカウント接続");
    const cookie = noteCookie(input.cookie);
    const u = (await call(cookie, "/v2/current_user")).data;
    if (!u?.urlname) throw new ConfigError("note: ログイン状態を確認できませんでした。Cookie を確認してください");
    return {
      accountId: String(u.id ?? u.urlname),
      accountName: `${u.nickname} (@${u.urlname})`,
      profileUrl: `https://note.com/${u.urlname}`,
      credentials: { cookie },
    };
  },
  async fetchProfile(ctx) {
    const cookie = ctx.credentials.cookie as string;
    if (!cookie) throw new ConfigError("note: アカウントを再接続してください");
    const u = (await call(cookie, "/v2/current_user")).data ?? {};
    const num = (v: unknown) => (typeof v === "number" ? v : undefined);
    const image = [u.profile_image_path, u.user_profile_image_path].find((v) => typeof v === "string" && /^https:\/\//.test(v));
    return { followers: num(u.follower_count), following: num(u.following_count), posts: num(u.note_count), imageUrl: image };
  },
  async fetchInsights(ctx): Promise<AccountInsights> {
    // 記事ごとの累計 PV・スキの合計。前日の累計との差分を日別の閲覧数・反応数にする
    const cookie = ctx.credentials.cookie as string;
    if (!cookie) throw new ConfigError("note: アカウントを再接続してください");
    let views = 0;
    let likes = 0;
    for (let page = 1; page <= 20; page++) {
      const r = (await call(cookie, `/v1/stats/pv?filter=all&page=${page}`)).data ?? {};
      const rows = (r.note_stats ?? []) as { read_count?: number; like_count?: number }[];
      for (const a of rows) {
        views += a.read_count ?? 0;
        likes += a.like_count ?? 0;
      }
      if (r.last_page || !rows.length) break;
    }
    return { totals: { views, engagements: likes } };
  },
  async publish(ctx, post) {
    const cookie = ctx.credentials.cookie as string;
    if (!cookie) throw new ConfigError("note: アカウントを再接続してください");
    const title = deriveTitle({ title: post.options.title || post.title, text: post.text }, 100);
    const price = notePrice(post.options.price);
    const md0 = post.text.replace(/^\s*#\s+(.+?)\s*\n/, (m, t) => (t.trim() === title ? "" : m));
    const md = md0 + (post.link && !post.text.includes(post.link) ? `\n\n${post.link}` : "");
    const tags = (post.tags ?? []).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
    const warnings: string[] = [];

    const created = (await call(cookie, "/v1/text_notes", { method: "POST", json: { template_key: null } })).data;

    // 本文の画像をアップロードして、本文の参照先 → note の画像 URL の対応を作る
    const images: Record<string, string> = {};
    for (const src of markdownImageSources(md)) {
      const file = findMedia(post.media, src);
      if (!file) {
        warnings.push(`画像「${src}」が添付に見つかりません`);
        continue;
      }
      try {
        images[src] = await uploadBodyImage(cookie, file);
      } catch (e) {
        if (e instanceof ConfigError) throw e;
        warnings.push(`画像「${file.filename}」をアップロードできませんでした`);
      }
    }
    const { html, separator } = markdownToNote(md, { note: true, images });

    // 見出し画像（失敗しても本文は保存する）
    const eyecatch = post.options.eyecatch ? findMedia(post.media, post.options.eyecatch) : undefined;
    if (post.options.eyecatch && !eyecatch) warnings.push("見出し画像が添付に見つかりません");
    if (eyecatch) {
      // 見出し画像は 1280×670（記事エディタで生成・アップロードしたものはこのサイズに整えてある）
      await upload(cookie, "/v1/image_upload/note_eyecatch", eyecatch, { note_id: String(created.id), width: "1280", height: "670" }).catch((e) => {
        if (e instanceof ConfigError) throw e;
        warnings.push("見出し画像を設定できませんでした（編集画面で設定してください）");
      });
    }

    const base = {
      name: title,
      body: html,
      body_length: htmlTextLength(html),
      status: "draft",
      note_type: "TextNote",
      index: false,
      is_lead_form: false,
      ...(tags.length ? { hashtag_notes: tags.map((name) => ({ hashtag: { name } })) } : {}),
    };
    const paid = price !== null && separator ? { price, separator } : {};
    if (price !== null && !separator) warnings.push("有料ライン（<!-- paywall -->）が本文に無いため、無料記事として保存しました");
    if (price === null && separator) warnings.push("価格が未入力のため、有料ラインは設定していません");
    try {
      await call(cookie, `/v1/text_notes/draft_save?id=${created.id}`, { method: "POST", json: { ...base, ...paid } });
    } catch (e) {
      // 有料設定が受け付けられない場合は、本文だけでも保存する
      if (!("price" in paid) || e instanceof ConfigError) throw e;
      await call(cookie, `/v1/text_notes/draft_save?id=${created.id}`, { method: "POST", json: base });
      warnings.push("有料ライン・価格を設定できませんでした（編集画面で設定してください）");
    }

    const done = [
      Object.keys(images).length ? `画像${Object.keys(images).length}枚` : "",
      eyecatch && !warnings.some((w) => w.startsWith("見出し画像")) ? "見出し画像" : "",
      "price" in paid ? `有料ライン・価格${price}円` : "",
      tags.length ? `タグ${tags.length}件` : "",
    ].filter(Boolean);
    return {
      postId: String(created.key),
      url: `https://note.com/notes/${created.key}/edit`,
      note: [`下書きに保存しました${done.length ? `（${done.join("・")}）` : ""}。note の編集画面で確認して公開してください`, ...warnings].join(" / "),
    };
  },
};
