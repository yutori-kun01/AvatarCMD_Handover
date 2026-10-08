// ================================================
// Zenn — GitHub リポジトリ連携（Zenn 公式の投稿方法）
// ================================================
// 公式: https://zenn.dev/zenn/articles/connect-to-github
//       https://zenn.dev/zenn/articles/zenn-cli-guide
// Zenn に投稿APIは無い。連携済み GitHub リポジトリの articles/<slug>.md を push すると
// Zenn 側が自動でデプロイする。ここでは GitHub REST API (Contents) でファイルを作成する。
//   - PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}
//   - slug: a-z0-9, ハイフン, アンダースコア の 12〜50 文字

import { randomBytes } from "crypto";
import type { PlatformDefinition } from "../types";
import { ConfigError, deriveTitle, requestJson, requireFields } from "../http";

const GH = "https://api.github.com";

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "avatar-cmd",
  };
}

function yamlString(s: string) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function zennSlug(): string {
  return randomBytes(7).toString("hex"); // 14文字
}

export function zennTopics(tags: string[] | undefined): string[] {
  return (tags ?? [])
    .map((t) => t.toLowerCase().replace(/^#/, "").replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 5);
}

async function putFile(token: string, repo: string, branch: string, path: string, content: Buffer, message: string) {
  return requestJson("zenn", `${GH}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: ghHeaders(token),
    json: { message, content: content.toString("base64"), branch },
  });
}

export const zenn: PlatformDefinition = {
  id: "zenn",
  name: "Zenn",
  icon: "📘",
  support: "official",
  connection: "credentials",
  maxLength: 100_000,
  appFields: [],
  accountFields: [
    { key: "repo", label: "GitHubリポジトリ", required: true, placeholder: "owner/zenn-content", help: "Zenn と連携済みのリポジトリ" },
    { key: "branch", label: "ブランチ", placeholder: "main", help: "Zenn のデプロイ対象ブランチ" },
    { key: "token", label: "GitHub トークン", type: "password", required: true, help: "Fine-grained personal access token（対象リポジトリの Contents: Read and write）" },
    { key: "zennUsername", label: "Zenn ユーザー名", required: true, help: "記事URLの生成に使用" },
  ],
  settingFields: [
    {
      key: "published",
      label: "公開状態",
      type: "select",
      default: "false",
      options: [
        { value: "false", label: "下書き (published: false)" },
        { value: "true", label: "公開 (published: true)" },
      ],
    },
    {
      key: "type",
      label: "記事タイプ",
      type: "select",
      default: "tech",
      options: [
        { value: "tech", label: "tech（技術記事）" },
        { value: "idea", label: "idea（アイデア）" },
      ],
    },
    { key: "emoji", label: "アイキャッチ絵文字", default: "📝" },
  ],
  postFields: [{ key: "title", label: "記事タイトル" }],
  media: { image: true, video: false, maxCount: 20 },
  docs: [
    { label: "GitHub リポジトリで Zenn のコンテンツを管理する", url: "https://zenn.dev/zenn/articles/connect-to-github" },
    { label: "Zenn CLI ガイド（Front Matter）", url: "https://zenn.dev/zenn/articles/zenn-cli-guide" },
    { label: "GitHub: Create or update file contents", url: "https://docs.github.com/rest/repos/contents#create-or-update-file-contents" },
  ],
  notes: [
    "Zenn のダッシュボード > GitHub からの連携 でリポジトリを連携しておいてください。",
    "トピックは投稿時のタグ（英数字）から最大5件設定されます。画像はリポジトリの /images に保存されます。",
  ],
  async connect(_app, input) {
    requireFields("Zenn", input, ["repo", "token", "zennUsername"], "アカウント接続");
    const repo = input.repo.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    const r = await requestJson("zenn", `${GH}/repos/${repo}`, { headers: ghHeaders(input.token.trim()) });
    if (r.permissions && !r.permissions.push) throw new ConfigError("Zenn: トークンにリポジトリへの書き込み権限がありません");
    return {
      accountId: `${input.zennUsername.trim()}@${repo}`,
      accountName: `${input.zennUsername.trim()} (${repo})`,
      profileUrl: `https://zenn.dev/${input.zennUsername.trim()}`,
      credentials: {
        repo,
        branch: input.branch?.trim() || r.default_branch || "main",
        token: input.token.trim(),
        zennUsername: input.zennUsername.trim(),
      },
    };
  },
  async publish(ctx, post) {
    const c = ctx.credentials as Record<string, string>;
    if (!c.repo || !c.token) throw new ConfigError("Zenn: アカウントを再接続してください");
    const s = ctx.settings as Record<string, string>;
    const slug = zennSlug();
    const title = deriveTitle({ title: post.options.title || post.title, text: post.text }, 70);

    let body = post.text.replace(/^\s*#\s+.*\n/, (m) => (m.replace(/^\s*#\s+/, "").trim() === title ? "" : m));
    for (const [i, m] of post.media.entries()) {
      const ext = m.filename.includes(".") ? m.filename.split(".").pop() : m.mimeType.split("/")[1];
      const path = `images/${slug}/${i + 1}.${ext}`;
      await putFile(c.token, c.repo, c.branch, path, Buffer.from(await m.load()), `Add image for ${slug}`);
      body += `\n\n![${m.alt ?? ""}](/${path})`;
    }
    if (post.link && !post.text.includes(post.link)) body += `\n\n${post.link}`;

    const fm = [
      "---",
      `title: ${yamlString(title)}`,
      `emoji: ${yamlString(s.emoji || "📝")}`,
      `type: ${yamlString(s.type || "tech")}`,
      `topics: [${zennTopics(post.tags).map(yamlString).join(", ")}]`,
      `published: ${s.published === "true" ? "true" : "false"}`,
      "---",
      "",
    ].join("\n");
    await putFile(c.token, c.repo, c.branch, `articles/${slug}.md`, Buffer.from(fm + body.trim() + "\n"), `Add article: ${title}`);
    return {
      postId: slug,
      url: `https://zenn.dev/${c.zennUsername}/articles/${slug}`,
      note: s.published === "true" ? undefined : "下書き（published: false）として保存しました",
    };
  },
};
