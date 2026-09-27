// ================================================
// note — 公開APIなし。ログインセッションで「下書き保存」まで行う
// ================================================
// note.com は公式の投稿APIを提供していない。ここでは note の Web エディタが使う
// エンドポイント（非公式）にログイン Cookie で下書きを作成する。
//   - GET  https://note.com/api/v2/current_user            ログイン確認
//   - POST https://note.com/api/v1/text_notes               空の下書きを作成 → { id, key }
//   - POST https://note.com/api/v1/text_notes/draft_save?id= 本文を保存
// 公開・有料設定は取り消しが効かないため自動では行わない（編集画面で本人が公開する）。
// 仕様変更で動かなくなる可能性がある。

import type { PlatformDefinition } from "../types";
import { ApiError, ConfigError, deriveTitle, requestJson, requireFields } from "../http";
import { htmlTextLength, markdownToHtml } from "../markdown";

const API = "https://note.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export function noteCookie(raw: string): string {
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

async function call(cookie: string, path: string, init: { method?: string; json?: unknown } = {}) {
  try {
    return await requestJson("note", API + path, { method: init.method ?? "GET", headers: headers(cookie), json: init.json, redirect: "manual" });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      throw new ConfigError("note: ログインセッションが切れています。Cookie（_note_session_v5）を取り直して再接続してください");
    }
    throw e;
  }
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
  postFields: [{ key: "title", label: "記事タイトル" }],
  media: { image: false, video: false, maxCount: 0 },
  docs: [{ label: "note ヘルプ", url: "https://www.help-note.com/hc/ja" }],
  notes: [
    "note には公開APIがないため、ログインCookieを使って「下書き保存」まで自動で行います。公開は note の編集画面で行ってください。",
    "Cookie はログアウトすると無効になります。期限切れのエラーが出たら取り直して再接続してください。",
    "画像は自動アップロードされず「［画像：…］」の目印になります。非公式の仕組みのため、note 側の変更で動かなくなる場合があります。",
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
  async publish(ctx, post) {
    const cookie = ctx.credentials.cookie as string;
    if (!cookie) throw new ConfigError("note: アカウントを再接続してください");
    const title = deriveTitle({ title: post.options.title || post.title, text: post.text }, 100);
    const md = post.text.replace(/^\s*#\s+(.+?)\s*\n/, (m, t) => (t.trim() === title ? "" : m));
    const html = markdownToHtml(md + (post.link && !post.text.includes(post.link) ? `\n\n${post.link}` : ""), { note: true });
    const tags = (post.tags ?? []).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);

    const created = (await call(cookie, "/v1/text_notes", { method: "POST", json: { template_key: null } })).data;
    await call(cookie, `/v1/text_notes/draft_save?id=${created.id}`, {
      method: "POST",
      json: {
        name: title,
        body: html,
        body_length: htmlTextLength(html),
        status: "draft",
        note_type: "TextNote",
        index: false,
        is_lead_form: false,
        ...(tags.length ? { hashtag_notes: tags.map((name) => ({ hashtag: { name } })) } : {}),
      },
    });
    return {
      postId: String(created.key),
      url: `https://note.com/notes/${created.key}/edit`,
      note: "下書きとして保存しました。note の編集画面で確認して公開してください",
    };
  },
};
