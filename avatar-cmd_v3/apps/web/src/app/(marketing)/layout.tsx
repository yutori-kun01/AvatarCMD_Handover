import React from "react"
import Link from "next/link"

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative min-h-screen bg-[#050508] text-white overflow-x-hidden">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-50 border-b border-white/5 bg-[#050508]/80 backdrop-blur-xl">
        <nav className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-lg font-extrabold tracking-wider bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] bg-clip-text text-transparent">
            Avatar CMD
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <Link href="/#features" className="text-sm text-white/60 hover:text-white transition-colors">サービス</Link>
            <Link href="/#pricing" className="text-sm text-white/60 hover:text-white transition-colors">プラン</Link>
            <Link href="/#workflow" className="text-sm text-white/60 hover:text-white transition-colors">導入フロー</Link>
            <Link href="/blog" className="text-sm text-white/60 hover:text-white transition-colors">ブログ</Link>
            <Link href="/#faq" className="text-sm text-white/60 hover:text-white transition-colors">FAQ</Link>
          </div>
          <Link href="/dashboard" className="hidden md:inline-flex px-4 py-2 text-sm text-white/60 hover:text-white transition-colors">ログイン</Link>
          <Link href="/#pricing" className="hidden md:inline-flex px-5 py-2 bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] rounded-full text-sm font-semibold shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all">
            プランを見る
          </Link>
        </nav>
      </header>

      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-16">
        <div className="max-w-[1200px] mx-auto px-6 grid md:grid-cols-3 gap-12">
          <div>
            <span className="text-lg font-extrabold tracking-wider bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] bg-clip-text text-transparent">
              Avatar CMD
            </span>
            <p className="mt-3 text-sm text-white/40">
              OpenClaw × AIアバター。セットアップ済みPCをお届けする、コスパ重視のAI導入支援。
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-4">サービス</h4>
            <ul className="space-y-2 text-sm text-white/40">
              <li><Link href="/#features" className="hover:text-white transition-colors">特徴</Link></li>
              <li><Link href="/#pricing" className="hover:text-white transition-colors">プラン</Link></li>
              <li><Link href="/#workflow" className="hover:text-white transition-colors">導入フロー</Link></li>
              <li><Link href="/blog" className="hover:text-white transition-colors">ブログ</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-4">サポート</h4>
            <ul className="space-y-2 text-sm text-white/40">
              <li><Link href="/#faq" className="hover:text-white transition-colors">FAQ</Link></li>
              <li><a href="https://x.com/and_and_and_and" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">X (Twitter)</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-[1200px] mx-auto px-6 mt-12 pt-8 border-t border-white/5">
          <p className="text-xs text-white/30">&copy; 2026 Avatar CMD. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
