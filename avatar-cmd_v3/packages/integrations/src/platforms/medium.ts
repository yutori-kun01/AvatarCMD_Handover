// ================================================
// Medium — Medium API v1（レガシー）
// ================================================
// 公式: https://github.com/Medium/medium-api-docs
// Medium は API の新規受付を終了しており、新しい Integration token は発行されない。
// 既に発行済みのトークンは引き続き利用できるため、持っている人向けに対応する。
//   - GET  https://api.medium.com/v1/me
//   - POST https://api.medium.com/v1/users/{authorId}/posts { title, contentFormat, content, tags, publishStatus }

import type { PlatformDefinition } from "../types";
import { ConfigError, deriveTitle, requestJson, requireFields } from "../http";

const API = "https://api.medium.com/v1";

export const medium: PlatformDefinition = {
  id: "medium",
  name: "Medium",
  icon: "📰",
  support: "legacy",
  connection: "credentials",
  maxLength: 100_000,
  appFields: [],
  accountFields: [{ key: "token", label: "Integration token", type: "password", required: true, help: "発行済みのトークンのみ使用可能（新規発行は終了）" }],
  settingFields: [
    {
      key: "publishStatus",
      label: "公開状態",
      type: "select",
      default: "draft",
      options: [
        { value: "draft", label: "下書き" },
        { value: "public", label: "公開" },
        { value: "unlisted", label: "限定公開" },
      ],
    },
  ],
  postFields: [{ key: "title", label: "記事タイトル" }],
  media: { image: false, video: false, maxCount: 0 },
  docs: [{ label: "Medium API docs (archived)", url: "https://github.com/Medium/medium-api-docs" }],
  notes: ["Medium は新規の Integration token 発行を終了しています。既存トークンをお持ちの場合のみ利用できます。"],
  async connect(_app, input) {
    requireFields("Medium", input, ["token"], "アカウント接続");
    const me = await requestJson("medium", `${API}/me`, { headers: { Authorization: `Bearer ${input.token.trim()}`, Accept: "application/json" } });
    return {
      accountId: me.data.id,
      accountName: `@${me.data.username}`,
      profileUrl: me.data.url,
      credentials: { token: input.token.trim(), authorId: me.data.id },
    };
  },
  async publish(ctx, post) {
    const c = ctx.credentials as Record<string, string>;
    if (!c.token) throw new ConfigError("Medium: アカウントを再接続してください");
    const title = deriveTitle({ title: post.options.title || post.title, text: post.text }, 100);
    const content = `# ${title}\n\n${post.text}${post.link && !post.text.includes(post.link) ? `\n\n${post.link}` : ""}`;
    const d = await requestJson("medium", `${API}/users/${c.authorId || ctx.account.accountId}/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json" },
      json: {
        title,
        contentFormat: "markdown",
        content,
        tags: (post.tags ?? []).slice(0, 5),
        publishStatus: (ctx.settings.publishStatus as string) || "draft",
      },
    });
    return { postId: d.data.id, url: d.data.url };
  },
};
