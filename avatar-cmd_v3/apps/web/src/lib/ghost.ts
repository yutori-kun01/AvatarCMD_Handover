import GhostContentAPI from '@tryghost/content-api'

const api = new GhostContentAPI({
  url: process.env.GHOST_URL || 'https://blog.10x-dev.tech',
  key: process.env.GHOST_CONTENT_API_KEY || '',
  version: 'v5.0',
})

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

export async function getPosts(limit = 15): Promise<GhostPost[]> {
  try {
    const posts = await api.posts.browse({
      limit,
      include: ['tags'],
      fields: ['id', 'slug', 'title', 'excerpt', 'feature_image', 'published_at', 'reading_time'],
    })
    return posts as unknown as GhostPost[]
  } catch {
    console.error('Failed to fetch Ghost posts')
    return []
  }
}

export async function getPostBySlug(slug: string): Promise<GhostPost | null> {
  try {
    const post = await api.posts.read({ slug }, { include: ['tags'] })
    return post as unknown as GhostPost
  } catch {
    console.error(`Failed to fetch post: ${slug}`)
    return null
  }
}

export async function getPostsByTag(tag: string, limit = 15): Promise<GhostPost[]> {
  try {
    const posts = await api.posts.browse({
      limit,
      filter: `tag:${tag}`,
      include: ['tags'],
      fields: ['id', 'slug', 'title', 'excerpt', 'feature_image', 'published_at', 'reading_time'],
    })
    return posts as unknown as GhostPost[]
  } catch {
    console.error(`Failed to fetch posts by tag: ${tag}`)
    return []
  }
}

export async function getTags(): Promise<GhostTag[]> {
  try {
    const tags = await api.tags.browse({ limit: 'all', include: ['count.posts'] })
    return tags as unknown as GhostTag[]
  } catch {
    console.error('Failed to fetch Ghost tags')
    return []
  }
}
