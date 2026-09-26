"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut, Plus, ArrowLeft } from "lucide-react"

const pageTitles: Record<string, { title: string; description: string }> = {
  "/dashboard": { title: "ダッシュボード", description: "AIアバター運用コマンドセンター" },
  "/dashboard/avatars": { title: "アバター管理", description: "全アバターの詳細設定・人格ファイル編集" },
  "/dashboard/activity": { title: "アクティビティ", description: "AI生成ログ・システムイベントのタイムライン" },
  "/dashboard/sns": { title: "SNS運用", description: "投稿の作成・予約・配信管理" },
  "/dashboard/revenue": { title: "収益分析", description: "全アバター収益レポート" },
  "/dashboard/collab": { title: "コラボ連携", description: "アバター間の連携管理" },
  "/dashboard/knowledge": { title: "知識ベース", description: "学習データとナレッジソース管理" },
  "/dashboard/automation": { title: "自動化ルール", description: "スケジュール実行するタスクの管理" },
  "/dashboard/chrome": { title: "Chrome Empire", description: "Playwright ブラウザプールの監視" },
  "/dashboard/settings": { title: "設定", description: "システム全体の設定と稼働状況" },
}

export function Header({ user, signOutAction }: { user: { name?: string | null; email?: string | null; role?: string }; signOutAction: () => Promise<void> }) {
  const pathname = usePathname()
  const info = pageTitles[pathname] ?? { title: "Avatar CMD", description: "" }
  const initials = (user.name || user.email || "?").slice(0, 2).toUpperCase()

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-[#0a0a12]/80 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        {pathname !== "/dashboard" && (
          <Link href="/dashboard" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground" aria-label="ダッシュボードへ戻る">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold">{info.title}</h1>
          <p className="text-xs text-muted-foreground">{info.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/avatars?new=1"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] px-3 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:-translate-y-0.5 hover:shadow-blue-500/40"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">新規アバター</span>
        </Link>
        <div className="flex items-center gap-2 rounded-lg p-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">{initials}</div>
          <div className="hidden flex-col sm:flex">
            <span className="text-xs font-medium">{user.name || user.email}</span>
            <span className="text-[9px] text-primary">{user.role}</span>
          </div>
        </div>
        <form action={signOutAction}>
          <button type="submit" title="ログアウト" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  )
}
