"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bell, Plus, ArrowLeft, LogOut } from "lucide-react"

const pageTitles: Record<string, { title: string; description: string }> = {
  "/": { title: "ダッシュボード", description: "AIアバター運用コマンドセンター" },
  "/dashboard": { title: "ダッシュボード", description: "AIアバター運用コマンドセンター" },
  "/posts": { title: "投稿・記事", description: "SNSへの投稿・予約・送信状況と note 記事" },
  "/avatars": { title: "アバター", description: "アバターごとの分析・プロフィール・画像スタイル" },
  "/revenue": { title: "分析・収益", description: "アカウント別のバイタルと収益" },
  "/automation": { title: "自動化", description: "タスク自動化の設定と管理" },
  "/knowledge": { title: "ナレッジ・学習", description: "ナレッジ・改善処理・YouTube 学習" },
  "/settings": { title: "設定", description: "システム全体の設定" },
}

interface HeaderProps {
  title?: string
  description?: string
}

export function Header({ title, description }: HeaderProps) {
  const pathname = usePathname()
  const pageInfo = pageTitles[pathname] || { title: title || "Avatar CMD", description: description || "" }
  const displayTitle = title || pageInfo.title
  const displayDesc = description || pageInfo.description

  return (
    <header className="flex h-16 items-center justify-between border-b border-white/[0.08] bg-[#0a0a12]/80 backdrop-blur-xl px-6">
      <div className="flex items-center gap-3">
        {pathname !== "/dashboard" && (
          <Link
            href="/dashboard"
            className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70 no-underline"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold">{displayTitle}</h1>
          <p className="text-xs text-white/30">{displayDesc}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/avatars?new=1"
          className="gap-1.5 inline-flex items-center px-3 py-2 rounded-lg bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] text-sm font-medium text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all no-underline"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">新規アバター</span>
        </Link>

        <Link
          href="/dashboard?level=error#activity"
          title="エラーのアクティビティ"
          className="relative rounded-lg p-2 text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70"
        >
          <Bell className="h-4 w-4" />
        </Link>

        <button
          type="button"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" })
            window.location.href = "/login"
          }}
          title="ログアウト"
          className="flex items-center gap-2 rounded-lg p-1.5 text-white/50 hover:bg-white/[0.05] hover:text-white"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400">
            <LogOut className="h-3.5 w-3.5" />
          </div>
          <span className="hidden text-xs sm:inline">ログアウト</span>
        </button>
      </div>
    </header>
  )
}
