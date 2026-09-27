// ================================================
// WordPress — REST API v2（アプリケーションパスワード）
// ================================================
// 公式: https://developer.wordpress.org/rest-api/reference/posts/
//   - 認証: Basic <ユーザー名>:<アプリケーションパスワード>（WordPress 5.6+ 標準機能）
//   - 確認: GET  /wp-json/wp/v2/users/me?context=edit
//   - 画像: POST /wp-json/wp/v2/media（Content-Disposition でファイル名指定）
//   - 投稿: POST /wp-json/wp/v2/posts { title, content, status, featured_media }

import type { PlatformDefinition } from "../types";
import { basicAuth, ConfigError, deriveTitle, requestJson, requireFields } from "../http";
import { markdownToHtml } from "../markdown";

function site(url: string) {
  return url.trim().replace(/\/+$/, "");
}

export const wordpress: PlatformDefinition = {
  id: "wordpress",
  name: "WordPress",
  icon: "🔵",
  support: "official",
  connection: "credentials",
  appFields: [],
  accountFields: [
    { key: "siteUrl", label: "サイトURL", type: "url", required: true, placeholder: "https://example.com" },
    { key: "username", label: "ユーザー名", required: true },
    { key: "appPassword", label: "アプリケーションパスワード", type: "password", required: true, help: "WP管理画面 > ユーザー > プロフィール > アプリケーションパスワード で発行" },
  ],
  settingFields: [
    {
      key: "status",
      label: "投稿ステータス",
      type: "select",
      default: "publish",
      options: [
        { value: "publish", label: "公開" },
        { value: "draft", label: "下書き" },
        { value: "private", label: "非公開" },
      ],
    },
  ],
  postFields: [{ key: "title", label: "記事タイトル" }],
  media: { image: true, video: false, maxCount: 20 },
  docs: [
    { label: "REST API: Posts", url: "https://developer.wordpress.org/rest-api/reference/posts/" },
    { label: "Application Passwords", url: "https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/" },
  ],
  notes: ["本文は Markdown で書けます（HTML に変換して投稿）。HTTPS のサイトが必要です。"],
  async connect(_app, input) {
    requireFields("WordPress", input, ["siteUrl", "username", "appPassword"], "アカウント接続");
    const base = site(input.siteUrl);
    const me = await requestJson("wordpress", `${base}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: basicAuth(input.username.trim(), input.appPassword.trim()) },
    });
    return {
      accountId: `${new URL(base).host}#${me.id}`,
      accountName: `${me.name} (${new URL(base).host})`,
      profileUrl: base,
      credentials: { siteUrl: base, username: input.username.trim(), appPassword: input.appPassword.trim() },
    };
  },
  async publish(ctx, post) {
    const c = ctx.credentials as Record<string, string>;
    if (!c.siteUrl || !c.appPassword) throw new ConfigError("WordPress: アカウントを再接続してください");
    const auth = basicAuth(c.username, c.appPassword);
    const base = site(c.siteUrl);

    const uploaded: { id: number; url: string; alt?: string }[] = [];
    for (const m of post.media) {
      const d = await requestJson("wordpress", `${base}/wp-json/wp/v2/media`, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": m.mimeType,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(m.filename)}"`,
        },
        body: (await m.load()) as BodyInit,
      });
      uploaded.push({ id: d.id, url: d.source_url, alt: m.alt });
    }

    const looksHtml = /<\/?(p|div|h[1-6]|ul|ol|br)\b/i.test(post.text);
    let content = looksHtml ? post.text : markdownToHtml(post.text);
    for (const u of uploaded.slice(1)) content += `\n<figure><img src="${u.url}" alt="${u.alt ?? ""}"></figure>`;
    if (post.link && !post.text.includes(post.link)) content += `\n<p><a href="${post.link}">${post.link}</a></p>`;

    const d = await requestJson("wordpress", `${base}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { Authorization: auth },
      json: {
        title: deriveTitle({ title: post.options.title || post.title, text: post.text }, 200),
        content,
        status: (ctx.settings.status as string) || "publish",
        ...(uploaded[0] ? { featured_media: uploaded[0].id } : {}),
      },
    });
    return { postId: String(d.id), url: d.link };
  },
};
