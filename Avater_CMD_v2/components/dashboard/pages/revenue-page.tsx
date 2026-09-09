"use client"

import { useMemo } from "react"
import {
  DollarSign,
  TrendingUp,
  BarChart3,
  ArrowUpRight,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useApiData } from "@/hooks/use-api"

interface RevenueEntry {
  id: string
  avatarId: string
  type: string
  amount: number
  description: string | null
  platform: string | null
  earnedAt: string
  avatar?: { id: string; name: string }
}

interface RevenueTotals {
  avatarId: string
  _sum: { amount: number | null }
  _count: number
}

interface RevenueResponse {
  entries: RevenueEntry[]
  totals: RevenueTotals[]
}

interface AvatarFromApi {
  id: string
  name: string
}

export function RevenuePage() {
  const { data: revenueData, loading } = useApiData<RevenueResponse>("/api/revenue")
  const { data: avatars } = useApiData<AvatarFromApi[]>("/api/avatars")

  const entries = revenueData?.entries || []
  const totals = revenueData?.totals || []

  const summary = useMemo(() => {
    const total = totals.reduce((sum, t) => sum + (t._sum.amount || 0), 0)
    const entryCount = entries.length

    // Group by type
    const byType = entries.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + e.amount
        return acc
      },
      {} as Record<string, number>
    )

    // Top avatar
    const avatarMap = new Map<string, number>()
    for (const t of totals) {
      const name = avatars?.find((a) => a.id === t.avatarId)?.name || t.avatarId
      avatarMap.set(name, t._sum.amount || 0)
    }
    const topAvatar = [...avatarMap.entries()].sort((a, b) => b[1] - a[1])[0]

    return { total, entryCount, byType, topAvatar, avatarMap }
  }, [entries, totals, avatars])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: "総収益",
            value: `¥${summary.total.toLocaleString()}`,
            icon: DollarSign,
            color: "text-accent",
          },
          {
            label: "記録数",
            value: `${summary.entryCount}件`,
            icon: BarChart3,
            color: "text-primary",
          },
          {
            label: "トップアバター",
            value: summary.topAvatar ? summary.topAvatar[0] : "-",
            icon: TrendingUp,
            color: "text-foreground",
          },
          {
            label: "収益源",
            value: `${Object.keys(summary.byType).length}種`,
            icon: ArrowUpRight,
            color: "text-[#fbbf24]",
          },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <kpi.icon className="h-3.5 w-3.5" />
              <span>{kpi.label}</span>
            </div>
            <p className={cn("mt-2 text-2xl font-bold", kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Revenue by Type */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">収益源内訳</h3>
          <div className="mt-4 space-y-3">
            {Object.entries(summary.byType).length > 0 ? (
              Object.entries(summary.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, amount]) => {
                  const pct = summary.total > 0 ? Math.round((amount / summary.total) * 100) : 0
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground">{type}</span>
                        <span className="text-muted-foreground">¥{amount.toLocaleString()} ({pct}%)</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })
            ) : (
              <p className="text-sm text-muted-foreground">収益データがありません</p>
            )}
          </div>
        </div>

        {/* Revenue by Avatar */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">アバター別収益</h3>
          <div className="mt-4 space-y-3">
            {[...summary.avatarMap.entries()].length > 0 ? (
              [...summary.avatarMap.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, amount]) => {
                  const pct = summary.total > 0 ? Math.round((amount / summary.total) * 100) : 0
                  return (
                    <div key={name}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground">{name}</span>
                        <span className="text-muted-foreground">¥{amount.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })
            ) : (
              <p className="text-sm text-muted-foreground">収益データがありません</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Revenue Entries */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">最近の収益記録</h3>
        </div>
        <div className="divide-y divide-border">
          {entries.length > 0 ? (
            entries.slice(0, 20).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {entry.description || entry.type}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{entry.avatar?.name || "不明"}</span>
                      {entry.platform && <span>• {entry.platform}</span>}
                      <span>• {new Date(entry.earnedAt).toLocaleDateString("ja-JP")}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-accent">¥{entry.amount.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">{entry.type}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              収益記録がありません
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
