// ================================================
// Bluesky — AT Protocol（公式SDK @atproto/api）
// ================================================
// 公式: https://docs.bsky.app/docs/advanced-guides/posts
//   - 認証: com.atproto.server.createSession（アプリパスワード）
//   - 投稿: app.bsky.feed.post レコード（リンク・メンション・ハッシュタグは facets で表現）
//   - 画像: com.atproto.repo.uploadBlob → app.bsky.embed.images（最大4枚・1枚1MB未満）

import { AtpAgent, RichText } from "@atproto/api";
import type { PlatformDefinition } from "../types";
import { ConfigError, networkError, requireFields } from "../http";

const DEFAULT_SERVICE = "https://bsky.social";
const MAX_IMAGE_BYTES = 1_000_000;

async function login(service: string, identifier: string, password: string) {
  const agent = new AtpAgent({ service });
  try {
    await agent.login({ identifier, password });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new ConfigError("Bluesky: ハンドルまたはアプリパスワードが違います");
    if (!status) throw networkError("Bluesky", service, e);
    throw e;
  }
  return agent;
}

export const bluesky: PlatformDefinition = {
  id: "bluesky",
  name: "Bluesky",
  icon: "🦋",
  support: "official",
  connection: "credentials",
  maxLength: 300,
  appFields: [],
  accountFields: [
    { key: "identifier", label: "ハンドル", required: true, placeholder: "yourname.bsky.social" },
    { key: "appPassword", label: "アプリパスワード", type: "password", required: true, help: "設定 > プライバシーとセキュリティ > アプリパスワード で発行（通常のパスワードは使わない）" },
    { key: "service", label: "PDS / サービスURL", placeholder: DEFAULT_SERVICE, help: "通常は空欄（bsky.social）" },
  ],
  settingFields: [],
  postFields: [],
  media: { image: true, video: false, maxCount: 4 },
  docs: [
    { label: "Creating a post", url: "https://docs.bsky.app/docs/advanced-guides/posts" },
    { label: "App Passwords", url: "https://bsky.app/settings/app-passwords" },
  ],
  notes: ["開発者アプリの登録は不要です。アカウント接続でハンドルとアプリパスワードを入力してください。"],
  async connect(_app, input) {
    requireFields("Bluesky", input, ["identifier", "appPassword"], "アカウント接続");
    const service = input.service?.trim() || DEFAULT_SERVICE;
    const agent = await login(service, input.identifier.trim(), input.appPassword.trim());
    const s = agent.session!;
    return {
      accountId: s.did,
      accountName: `@${s.handle}`,
      profileUrl: `https://bsky.app/profile/${s.handle}`,
      credentials: { identifier: input.identifier.trim(), appPassword: input.appPassword.trim(), service },
    };
  },
  async fetchProfile(ctx) {
    // 公開プロフィールは認証なしで取得できる（ログイン回数を増やさない）
    const actor = ctx.account.accountId || ctx.account.accountName.replace(/^@/, "");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const { data } = await agent.getProfile({ actor });
    return { followers: data.followersCount, following: data.followsCount, posts: data.postsCount, imageUrl: data.avatar };
  },
  async publish(ctx, post) {
    const c = ctx.credentials as Record<string, string>;
    if (!c.identifier || !c.appPassword) throw new ConfigError("Bluesky: アカウントを再接続してください");
    if (post.media.some((m) => m.mimeType.startsWith("video/"))) throw new ConfigError("Bluesky: 動画投稿には未対応です（画像のみ）");
    const agent = await login(c.service || DEFAULT_SERVICE, c.identifier, c.appPassword);

    const text = post.link && !post.text.includes(post.link) ? `${post.text}\n${post.link}` : post.text;
    const rt = new RichText({ text });
    await rt.detectFacets(agent);
    if (rt.graphemeLength > 300) throw new ConfigError(`Bluesky: 本文が300文字を超えています（${rt.graphemeLength}文字）`);

    const images = [];
    for (const m of post.media.slice(0, 4)) {
      const bytes = await m.load();
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ConfigError(`Bluesky: 画像 ${m.filename} が1MBを超えています`);
      const up = await agent.uploadBlob(bytes, { encoding: m.mimeType });
      images.push({ image: up.data.blob, alt: m.alt ?? "" });
    }

    const res = await agent.post({
      text: rt.text,
      facets: rt.facets,
      ...(images.length ? { embed: { $type: "app.bsky.embed.images", images } } : {}),
      createdAt: new Date().toISOString(),
    });
    const rkey = res.uri.split("/").pop();
    const handle = agent.session?.handle ?? ctx.account.accountName.replace(/^@/, "");
    return { postId: res.uri, url: `https://bsky.app/profile/${handle}/post/${rkey}` };
  },
};
