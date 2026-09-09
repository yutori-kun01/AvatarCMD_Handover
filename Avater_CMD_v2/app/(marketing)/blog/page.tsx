import Link from "next/link"
import type { Metadata } from "next"
import { getPosts, getTags } from "@/lib/ghost"

export const metadata: Metadata = {
  title: "ブログ | Avatar CMD",
  description: "AIエージェント導入・SNS自動運用・OpenClawの活用ガイドを発信しています。",
}

export const revalidate = 3600 // ISR: 1時間ごとに再生成

export default async function BlogPage() {
  const [posts, tags] = await Promise.all([getPosts(20), getTags()])

  return (
    <div className="pt-28 pb-24">
      <div className="max-w-[1200px] mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block px-3.5 py-1 text-xs font-semibold uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">
            Blog
          </span>
          <h1 className="text-4xl font-bold tracking-tight mb-3">Avatar CMD ブログ</h1>
          <p className="text-white/60 max-w-lg mx-auto">
            OpenClawの導入事例・セキュリティ・活用ガイドを発信しています。
          </p>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            <Link href="/blog" className="px-3 py-1.5 text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full hover:bg-blue-500/20 transition-colors">
              すべて
            </Link>
            {tags.filter(t => (t.count?.posts ?? 0) > 0).map((tag) => (
              <Link
                key={tag.slug}
                href={`/blog/category/${tag.slug}`}
                className="px-3 py-1.5 text-xs font-medium bg-white/[0.04] text-white/50 border border-white/[0.08] rounded-full hover:text-white hover:border-white/20 transition-colors"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        )}

        {/* Posts Grid */}
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
                    <img
                      src={post.feature_image}
                      alt={post.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                )}
                <div className="p-6">
                  {post.primary_tag && (
                    <span className="inline-block px-2 py-0.5 text-[0.65rem] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full mb-3">
                      {post.primary_tag.name}
                    </span>
                  )}
                  <h2 className="text-lg font-semibold mb-2 group-hover:text-blue-400 transition-colors line-clamp-2">
                    {post.title}
                  </h2>
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
            <p className="text-white/40 text-lg mb-2">記事がまだありません</p>
            <p className="text-white/20 text-sm">Ghost CMS に記事を投稿すると、ここに表示されます。</p>
          </div>
        )}
      </div>
    </div>
  )
}
