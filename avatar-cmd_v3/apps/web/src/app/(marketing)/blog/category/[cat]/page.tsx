import Link from "next/link"
import type { Metadata } from "next"
import { getPostsByTag, getTags } from "@/lib/ghost"

interface Props {
  params: Promise<{ cat: string }>
}

export async function generateStaticParams() {
  const tags = await getTags()
  return tags.map((tag) => ({ cat: tag.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cat } = await params
  return {
    title: `${cat} の記事一覧 | Avatar CMD ブログ`,
    description: `Avatar CMD ブログの ${cat} カテゴリーの記事一覧です。`,
  }
}

export const revalidate = 3600

export default async function CategoryPage({ params }: Props) {
  const { cat } = await params
  const posts = await getPostsByTag(cat, 20)

  return (
    <div className="pt-28 pb-24">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="text-center mb-16">
          <Link href="/blog" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white mb-6 transition-colors">
            ← ブログ一覧に戻る
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            <span className="text-blue-400">#{cat}</span> の記事
          </h1>
        </div>

        {posts.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group block bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden hover:border-white/[0.15] hover:-translate-y-1 transition-all"
              >
                {post.feature_image && (
                  <div className="aspect-video bg-white/5 overflow-hidden">
                    <img src={post.feature_image} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  </div>
                )}
                <div className="p-6">
                  <h2 className="text-lg font-semibold mb-2 group-hover:text-blue-400 transition-colors line-clamp-2">{post.title}</h2>
                  <p className="text-sm text-white/40 line-clamp-3 mb-4">{post.excerpt}</p>
                  <div className="flex items-center gap-3 text-xs text-white/30">
                    <time>{new Date(post.published_at).toLocaleDateString("ja-JP")}</time>
                    {post.reading_time > 0 && <span>· {post.reading_time}分で読める</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-white/40 text-lg mb-2">この カテゴリには記事がまだありません</p>
          </div>
        )}
      </div>
    </div>
  )
}
