// Ghost CMS Content API client (marketing blog). Degrades gracefully to an
// empty blog when GHOST_CONTENT_API_KEY is not configured.
import GhostContentAPI from "@tryghost/content-api"

export interface GhostPost {
  id: string
  slug: string
  title: string
  html: string
  excerpt: string
  feature_image: string | null
  published_at: string
  reading_time: number
  tags: { name: string; slug: string }[]
  primary_tag: { name: string; slug: string } | null
}

export interface GhostTag {
  name: string
  slug: string
  count?: { posts: number }
}

type GhostApi = ReturnType<typeof GhostContentAPI>
let api: GhostApi | null | undefined

function client(): GhostApi | null {
  if (api !== undefined) return api
  const key = process.env.GHOST_CONTENT_API_KEY
  const url = process.env.GHOST_URL
  api = key && url ? GhostContentAPI({ url, key, version: "v5.0" }) : null
  return api
}

const FIELDS = ["id", "slug", "title", "excerpt", "feature_image", "published_at", "reading_time"]

export async function getPosts(limit = 15): Promise<GhostPost[]> {
  const c = client()
  if (!c) return []
  try {
    return (await c.posts.browse({ limit, include: ["tags"], fields: FIELDS })) as unknown as GhostPost[]
  } catch {
    console.error("Failed to fetch Ghost posts")
    return []
  }
}

export async function getPostBySlug(slug: string): Promise<GhostPost | null> {
  const c = client()
  if (!c) return null
  try {
    return (await c.posts.read({ slug }, { include: ["tags"] })) as unknown as GhostPost
  } catch {
    return null
  }
}

export async function getPostsByTag(tag: string, limit = 15): Promise<GhostPost[]> {
  const c = client()
  if (!c || !/^[a-z0-9-]+$/i.test(tag)) return []
  try {
    return (await c.posts.browse({ limit, filter: `tag:${tag}`, include: ["tags"], fields: FIELDS })) as unknown as GhostPost[]
  } catch {
    return []
  }
}

export async function getTags(): Promise<GhostTag[]> {
  const c = client()
  if (!c) return []
  try {
    return (await c.tags.browse({ limit: "all", include: ["count.posts"] })) as unknown as GhostTag[]
  } catch {
    return []
  }
}
