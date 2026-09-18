"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bell, Search, Plus, ArrowLeft } from "lucide-react"

const pageTitles: Record<string, { title: string; description: string }> = {
  "/dashboard": { title: "ダッシュボード", description: "AIアバター運用コマンドセンター" },
  "/dashboard/avatars": { title: "アバター管理", description: "全アバターの詳細設定と状態管理" },
  "/dashboard/activity": { title: "アクティビティ", description: "パフォーマンス分析 & 改善サイクル" },
  "/dashboard/sns": { title: "SNS運用", description: "プラットフォーム & コンテンツ管理" },
  "/dashboard/revenue": { title: "収益分析", description: "全アバター収益レポート" },
  "/dashboard/collab": { title: "コラボ連携", description: "アバター間の連携管理" },
  "/dashboard/knowledge": { title: "知識ベース", description: "学習データとナレッジソース管理" },
  "/dashboard/automation": { title: "自動化ルール", description: "タスク自動化の設定と管理" },
  "/dashboard/settings": { title: "設定", description: "システム全体の設定" },
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

      <div className="hidden items-center gap-2 rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 md:flex">
        <Search className="h-4 w-4 text-white/30" />
        <input
          type="text"
          placeholder="アバター・タスクを検索..."
          className="w-64 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        <kbd className="hidden rounded border border-white/[0.12] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/30 lg:inline-flex">
          /K
        </kbd>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/avatars"
          className="gap-1.5 inline-flex items-center px-3 py-2 rounded-lg bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] text-sm font-medium text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all no-underline"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">新規アバター</span>
        </Link>

        <button
          type="button"
          className="relative rounded-lg p-2 text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/70"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            3
          </span>
        </button>

        <div className="flex items-center gap-2 rounded-lg p-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-semibold text-cyan-400">
            TK
          </div>
          <div className="hidden flex-col sm:flex">
            <span className="text-xs font-medium">管理者</span>
            <span className="inline-flex items-center px-1.5 py-0 rounded border border-cyan-500/30 text-[9px] text-cyan-400 bg-cyan-500/10">
              Pro
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
