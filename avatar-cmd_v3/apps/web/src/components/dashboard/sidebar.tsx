"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  Activity,
  TrendingUp,
  Share2,
  Settings,
  MessageSquare,
  Brain,
  Zap,
  Chrome,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useApiData } from "@/hooks/use-api"

const navItems = [
  { icon: LayoutDashboard, label: "ダッシュボード", href: "/dashboard" },
  { icon: Users, label: "アバター管理", href: "/dashboard/avatars", badgeKey: "avatars" as const },
  { icon: Activity, label: "アクティビティ", href: "/dashboard/activity" },
  { icon: MessageSquare, label: "SNS運用", href: "/dashboard/sns" },
  { icon: TrendingUp, label: "収益分析", href: "/dashboard/revenue" },
  { icon: Share2, label: "コラボ連携", href: "/dashboard/collab" },
  { icon: Brain, label: "知識ベース", href: "/dashboard/knowledge" },
  { icon: Zap, label: "自動化ルール", href: "/dashboard/automation" },
  { icon: Chrome, label: "Chrome Empire", href: "/dashboard/chrome" },
]

interface SystemStatus {
  db: string
  queue: { backend: string; pending: number; failed: number } | null
  ai: { configured: boolean; model: string }
  publishMode: string
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { data: avatars } = useApiData<{ id: string }[]>("/api/avatars")
  const { data: system } = useApiData<SystemStatus>("/api/system")

  const healthy = system?.db === "ok"
  return (
    <aside className={cn("sticky top-0 flex h-screen flex-col border-r border-border bg-[#050508] transition-all duration-300", collapsed ? "w-16" : "w-64")}>
      <div className="flex h-16 items-center gap-3 border-b border-border px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6] shadow-lg shadow-blue-500/20">
          <Brain className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Avatar CMD</span>
            <span className="text-[10px] text-muted-foreground">v3.1</span>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const isActive = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href)
          const badge = item.badgeKey === "avatars" && avatars ? String(avatars.length) : undefined
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{item.label}</span>
                  {badge && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-medium text-primary">{badge}</span>
                  )}
                </>
              )}
            </Link>
          )
        })}
      </nav>

      {!collapsed && system && (
        <div className="mx-3 mb-3 space-y-1.5 rounded-lg border border-border bg-white/[0.03] p-3 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-2 text-xs">
            <div className={cn("h-2 w-2 rounded-full", healthy ? "animate-pulse bg-emerald-400" : "bg-red-500")} />
            <span>{healthy ? "システム正常稼働中" : "DB接続エラー"}</span>
          </div>
          <div className="flex justify-between"><span>キュー</span><span>{system.queue ? `${system.queue.backend} / 待機${system.queue.pending}` : "-"}</span></div>
          <div className="flex justify-between"><span>AI</span><span>{system.ai.configured ? system.ai.model : "モック"}</span></div>
          <div className="flex justify-between"><span>投稿モード</span><span>{system.publishMode === "live" ? "本番" : "ドライラン"}</span></div>
        </div>
      )}

      <div className="border-t border-border p-3">
        <Link
          href="/dashboard/settings"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
            pathname.startsWith("/dashboard/settings") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>設定</span>}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : (<><ChevronLeft className="h-4 w-4 shrink-0" /><span>折りたたむ</span></>)}
        </button>
      </div>
    </aside>
  )
}
