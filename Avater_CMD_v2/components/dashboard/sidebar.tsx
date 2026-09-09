"use client"

import { useState } from "react"
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

export type PageId =
  | "dashboard"
  | "avatars"
  | "activity"
  | "sns"
  | "revenue"
  | "collab"
  | "knowledge"
  | "automation"
  | "settings"

const navItems: { icon: typeof LayoutDashboard; label: string; id: PageId; badge?: string }[] = [
  { icon: LayoutDashboard, label: "ダッシュボード", id: "dashboard" },
  { icon: Users, label: "アバター管理", id: "avatars", badge: "5" },
  { icon: Activity, label: "アクティビティ", id: "activity" },
  { icon: MessageSquare, label: "SNS運用", id: "sns" },
  { icon: TrendingUp, label: "収益分析", id: "revenue" },
  { icon: Share2, label: "コラボ連携", id: "collab" },
  { icon: Brain, label: "知識ベース", id: "knowledge" },
  { icon: Zap, label: "自動化ルール", id: "automation" },
]

interface SidebarProps {
  activePage: PageId
  onNavigate: (page: PageId) => void
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border bg-sidebar-background transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Brain className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">
              Avatar CMD
            </span>
            <span className="text-[10px] text-muted-foreground">v2.4.1</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              activePage === item.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-medium text-primary">
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </nav>

      {/* System Status */}
      {!collapsed && (
        <div className="mx-3 mb-3 rounded-lg bg-secondary p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-accent" />
            <span>全システム正常稼働中</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>API使用量</span>
            <span>68%</span>
          </div>
          <div className="mt-1 h-1 w-full rounded-full bg-muted">
            <div className="h-1 w-[68%] rounded-full bg-primary" />
          </div>
        </div>
      )}

      {/* Bottom */}
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={() => onNavigate("settings")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
            activePage === "settings"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>設定</span>}
        </button>

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
