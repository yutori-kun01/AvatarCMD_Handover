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
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems: {
  icon: typeof LayoutDashboard
  label: string
  href: string
  badge?: string
}[] = [
  { icon: LayoutDashboard, label: "ダッシュボード", href: "/dashboard" },
  { icon: Users, label: "アバター管理", href: "/dashboard/avatars", badge: "5" },
  { icon: Activity, label: "アクティビティ", href: "/dashboard/activity" },
  { icon: MessageSquare, label: "SNS運用", href: "/dashboard/sns" },
  { icon: TrendingUp, label: "収益分析", href: "/dashboard/revenue" },
  { icon: Share2, label: "コラボ連携", href: "/dashboard/collab" },
  { icon: Brain, label: "知識ベース", href: "/dashboard/knowledge" },
  { icon: Zap, label: "自動化ルール", href: "/dashboard/automation" },
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
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href))
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

      {/* System Status */}
      {!collapsed && (
        <div className="mx-3 mb-3 rounded-lg bg-white/[0.03] border border-white/[0.08] p-3">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>全システム正常稼働中</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-white/30">
            <span>API使用量</span>
            <span>68%</span>
          </div>
          <div className="mt-1 h-1 w-full rounded-full bg-white/[0.06]">
            <div className="h-1 w-[68%] rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500" />
          </div>
        </div>
      )}

      {/* Bottom */}
      <div className="border-t border-white/[0.08] p-3">
        <Link
          href="/dashboard/settings"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors no-underline",
            pathname === "/dashboard/settings"
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
