// ================================================
// Ghost Content API クライアント（マーケティングサイトのブログ用）
// ================================================
// 公式: https://ghost.org/docs/content-api/
// GHOST_URL / GHOST_CONTENT_API_KEY が未設定、または取得に失敗した場合は空で返す
// （ブログが無くてもビルド・表示が壊れないようにするため）。
// 本文 HTML はダッシュボードと同じドメインで表示するので、Ghost が乗っ取られても XSS にならないようサニタイズする
// （script・イベント属性・javascript: URL を除去。埋め込みは YouTube / Vimeo / X などの https の iframe だけ許可）。

import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const EMBED_HOSTS = /^(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|platform\.twitter\.com|open\.spotify\.com|codepen\.io)$/;
let purifier: ReturnType<typeof createDOMPurify> | null = null;

export function sanitizeHtml(html: string): string {
  if (!purifier) {
    purifier = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);
    purifier.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName !== "iframe") return;
      const src = (node as Element).getAttribute?.("src") ?? "";
      let ok = false;
      try {
        const u = new URL(src);
        ok = u.protocol === "https:" && EMBED_HOSTS.test(u.hostname);
      } catch {
        ok = false;
      }
      if (!ok) node.parentNode?.removeChild(node);
    });
  }
  return purifier.sanitize(html ?? "", { ADD_TAGS: ["iframe"], ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "loading"], FORBID_TAGS: ["style", "form", "input", "button"] });
}

export interface GhostTag {
  id: string;
  name: string;
  slug: string;
  count?: { posts?: number };
}

export interface GhostPost {
  id: string;
  slug: string;
  title: string;
  html: string;
  excerpt: string;
  feature_image: string | null;
  published_at: string;
  reading_time: number;
  primary_tag: GhostTag | null;
  tags: GhostTag[];
}

async function ghost<T>(resource: string, params: Record<string, string>): Promise<T[]> {
  const url = process.env.GHOST_URL?.replace(/\/+$/, "");
  const key = process.env.GHOST_CONTENT_API_KEY;
  if (!url || !key) return [];
  try {
    const qs = new URLSearchParams({ key, ...params });
    const res = await fetch(`${url}/ghost/api/content/${resource}/?${qs}`, {
      headers: { "Accept-Version": "v5.0" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data[resource] ?? []) as T[];
  } catch {
    return [];
  }
}

function normalize(p: GhostPost): GhostPost {
  return { ...p, html: sanitizeHtml(p.html), tags: p.tags ?? [], reading_time: p.reading_time ?? 0, excerpt: p.excerpt ?? "" };
}

export async function getPosts(limit = 20): Promise<GhostPost[]> {
  return (await ghost<GhostPost>("posts", { limit: String(limit), include: "tags" })).map(normalize);
}

export async function getPostsByTag(tagSlug: string, limit = 20): Promise<GhostPost[]> {
  return (await ghost<GhostPost>("posts", { limit: String(limit), include: "tags", filter: `tag:${tagSlug}` })).map(normalize);
}

export async function getPostBySlug(slug: string): Promise<GhostPost | null> {
  const [p] = await ghost<GhostPost>("posts", { limit: "1", include: "tags", filter: `slug:${slug}` });
  return p ? normalize(p) : null;
}

export async function getTags(): Promise<GhostTag[]> {
  return ghost<GhostTag>("tags", { limit: "all", include: "count.posts" });
}
