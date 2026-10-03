"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  Activity,
  TrendingUp,
  Settings,
  MessageSquare,
  Brain,
  Zap,
  ChevronLeft,
  ChevronRight,
  Send,
  Wallet,
  BookOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems: {
  icon: typeof LayoutDashboard
  label: string
  href: string
  badge?: string
}[] = [
  { icon: LayoutDashboard, label: "ダッシュボード", href: "/dashboard" },
  { icon: Send, label: "投稿", href: "/posts" },
  { icon: Users, label: "アバター管理", href: "/avatars" },
  { icon: Activity, label: "アクティビティ", href: "/activity" },
  { icon: MessageSquare, label: "SNS運用", href: "/sns" },
  { icon: TrendingUp, label: "収益分析", href: "/revenue" },
  { icon: Zap, label: "自動化ルール", href: "/automation" },
  { icon: BookOpen, label: "ナレッジ・改善", href: "/knowledge" },
  { icon: Wallet, label: "API コスト", href: "/costs" },
]

interface SidebarProps {
  collapsed?: boolean
  onToggle?: () => void
}

export function Sidebar({ collapsed: controlledCollapsed, onToggle }: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const collapsed = controlledCollapsed ?? internalCollapsed
  const toggle = onToggle ?? (() => setInternalCollapsed(!internalCollapsed))
  const pathname = usePathname()
  const [status, setStatus] = useState<{ workerAlive: boolean; queued: number; failed24h: number; drafts: number } | null>(null)

  useEffect(() => {
    const load = () =>
      fetch("/api/status")
        .then((r) => (r.ok ? r.json() : null))
        .then(setStatus)
        .catch(() => setStatus(null))
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-white/[0.08] bg-[#050508] transition-all duration-300 sticky top-0",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-white/[0.08] px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6] shadow-lg shadow-blue-500/20">
          <Brain className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Avatar CMD</span>
            <span className="text-[10px] text-white/30">v3.0</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors no-underline",
                isActive
                  ? "bg-cyan-500/10 text-cyan-400"
                  : "text-white/40 hover:bg-white/[0.05] hover:text-white/80"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-[10px] font-medium text-cyan-400">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </Link>
          )
        })}
      </nav>

      {/* System Status（/api/status の実データ） */}
      {!collapsed && status && (
        <div className="mx-3 mb-3 space-y-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-[11px]">
          <div className="flex items-center gap-2 text-white/50">
            <div className={cn("h-2 w-2 rounded-full", status.workerAlive ? "bg-emerald-400 animate-pulse" : "bg-red-500")} />
            <span>{status.workerAlive ? "worker 稼働中" : "worker 停止中"}</span>
          </div>
          <div className="flex justify-between text-white/35">
            <span>送信待ち</span>
            <span>{status.queued}件</span>
          </div>
          {status.drafts > 0 && (
            <Link href="/posts" className="flex justify-between text-amber-300/80 no-underline">
              <span>承認待ち</span>
              <span>{status.drafts}件</span>
            </Link>
          )}
          {status.failed24h > 0 && (
            <Link href="/posts" className="flex justify-between text-red-300/80 no-underline">
              <span>24時間の失敗</span>
              <span>{status.failed24h}件</span>
            </Link>
          )}
        </div>
      )}

      {/* Bottom */}
      <div className="border-t border-white/[0.08] p-3">
        <Link
          href="/settings"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors no-underline",
            pathname === "/settings"
              ? "bg-cyan-500/10 text-cyan-400"
              : "text-white/40 hover:bg-white/[0.05] hover:text-white/80"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>設定</span>}
        </Link>

        <button
          type="button"
          onClick={toggle}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/60"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 shrink-0" />
              <span>折りたたむ</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
