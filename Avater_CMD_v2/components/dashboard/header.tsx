"use client"

import { Bell, Search, Plus, ArrowLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { PageId } from "./sidebar"

const pageTitles: Record<PageId, { title: string; description: string }> = {
  dashboard: { title: "ダッシュボード", description: "AIアバター運用コマンドセンター" },
  avatars: { title: "アバター管理", description: "全アバターの詳細設定と状態管理" },
  activity: { title: "アクティビティ", description: "リアルタイムの活動ログ" },
  sns: { title: "SNS運用", description: "各プラットフォームの投稿管理と分析" },
  revenue: { title: "収益分析", description: "マネタイズの詳細レポート" },
  collab: { title: "コラボ連携", description: "アバター間の連携管理" },
  knowledge: { title: "知識ベース", description: "学習データとナレッジソース管理" },
  automation: { title: "自動化ルール", description: "タスク自動化の設定と管理" },
  settings: { title: "設定", description: "システム全体の設定" },
}

interface HeaderProps {
  activePage: PageId
  onNavigate: (page: PageId) => void
}

export function Header({ activePage, onNavigate }: HeaderProps) {
  const pageInfo = pageTitles[activePage]

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-3">
        {activePage !== "dashboard" && (
          <button
            type="button"
            onClick={() => onNavigate("dashboard")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold text-foreground">
            {pageInfo.title}
          </h1>
          <p className="text-xs text-muted-foreground">
            {pageInfo.description}
          </p>
        </div>
      </div>

      <div className="hidden items-center gap-2 rounded-lg bg-secondary px-3 py-2 md:flex">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="アバター・タスクを検索..."
          className="w-64 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground lg:inline-flex">
          {"/"} K
        </kbd>
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => onNavigate("avatars")}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">新規アバター</span>
        </Button>

        <button
          type="button"
          className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
            3
          </span>
        </button>

        <div className="flex items-center gap-2 rounded-lg p-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
            TK
          </div>
          <div className="hidden flex-col sm:flex">
            <span className="text-xs font-medium text-foreground">管理者</span>
            <Badge
              variant="outline"
              className="h-4 border-primary/30 text-[9px] text-primary"
            >
              Pro
            </Badge>
          </div>
        </div>
      </div>
    </header>
  )
}
