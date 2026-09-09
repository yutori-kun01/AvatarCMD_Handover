import { notFound } from "next/navigation"
import Link from "next/link"
import type { Metadata } from "next"
import { getPostBySlug, getPosts } from "@/lib/ghost"

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  const posts = await getPosts(100)
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) return { title: "記事が見つかりません | Avatar CMD" }
  return {
    title: `${post.title} | Avatar CMD ブログ`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: post.feature_image ? [post.feature_image] : [],
    },
  }
}

export const revalidate = 3600

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) notFound()

  return (
    <div className="pt-28 pb-24">
      <div className="max-w-3xl mx-auto px-6">
        {/* Back link */}
        <Link href="/blog" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white mb-8 transition-colors">
          ← ブログ一覧に戻る
        </Link>

        {/* Article header */}
        <article>
          <div className="mb-8">
            {post.primary_tag && (
              <span className="inline-block px-2.5 py-0.5 text-[0.7rem] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full mb-4">
                {post.primary_tag.name}
              </span>
            )}
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight mb-4">
              {post.title}
            </h1>
            <div className="flex items-center gap-4 text-sm text-white/40">
              <time>{new Date(post.published_at).toLocaleDateString("ja-JP")}</time>
              {post.reading_time > 0 && <span>{post.reading_time}分で読める</span>}
            </div>
          </div>

          {post.feature_image && (
            <div className="rounded-2xl overflow-hidden mb-10 border border-white/[0.08]">
              <img src={post.feature_image} alt={post.title} className="w-full" />
            </div>
          )}

          {/* Article content */}
          <div
            className="prose prose-invert prose-sm sm:prose-base max-w-none
              prose-headings:font-bold prose-headings:tracking-tight
              prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4
              prose-h3:text-lg prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-white/70 prose-p:leading-relaxed
              prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
              prose-strong:text-white prose-strong:font-semibold
              prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
              prose-pre:bg-white/[0.03] prose-pre:border prose-pre:border-white/[0.08] prose-pre:rounded-xl
              prose-img:rounded-xl prose-img:border prose-img:border-white/[0.08]
              prose-ul:text-white/60 prose-ol:text-white/60
              prose-li:marker:text-blue-400"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />

          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="mt-12 pt-8 border-t border-white/5">
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Link
                    key={tag.slug}
                    href={`/blog/category/${tag.slug}`}
                    className="px-3 py-1 text-xs bg-white/[0.04] text-white/50 border border-white/[0.08] rounded-full hover:text-white hover:border-white/20 transition-colors"
                  >
                    #{tag.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </article>

        {/* CTA */}
        <div className="mt-16 p-8 bg-white/[0.03] border border-white/[0.08] rounded-2xl text-center">
          <h3 className="text-xl font-bold mb-2">Avatar CMD でAI環境を構築しませんか？</h3>
          <p className="text-sm text-white/50 mb-5">OpenClaw + AIアバター搭載PCを、セットアップ済みでお届け。</p>
          <Link href="/#pricing" className="inline-flex px-6 py-2.5 bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] rounded-full text-sm font-semibold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all">
            プランを見る
          </Link>
        </div>
      </div>
    </div>
  )
}
