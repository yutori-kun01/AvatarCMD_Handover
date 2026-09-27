// ================================================
// Ghost Content API クライアント（マーケティングサイトのブログ用）
// ================================================
// 公式: https://ghost.org/docs/content-api/
// GHOST_URL / GHOST_CONTENT_API_KEY が未設定、または取得に失敗した場合は空で返す
// （ブログが無くてもビルド・表示が壊れないようにするため）。

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
  return { ...p, tags: p.tags ?? [], reading_time: p.reading_time ?? 0, excerpt: p.excerpt ?? "" };
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
