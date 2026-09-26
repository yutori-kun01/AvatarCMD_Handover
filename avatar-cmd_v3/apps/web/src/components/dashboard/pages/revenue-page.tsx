"use client"

import { useMemo, useState } from "react"
import {
  DollarSign,
  TrendingUp,
  BarChart3,
  ArrowUpRight,
  Loader2,
  Plus,
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
  totalRevenue: number
  monthlyGrowth: number
  bySource: { source: string; total: number; percentage: number }[]
  byPlatform: { platform: string; total: number }[]
  monthly: { month: string; total: number }[]
}

const SOURCE_LABELS: Record<string, string> = {
  affiliate: "アフィリエイト",
  paid_content: "有料コンテンツ",
  sponsorship: "スポンサー",
  donation: "投げ銭・サポート",
  ad_revenue: "広告収益",
  subscription: "サブスク",
  merchandise: "物販",
}

interface AvatarFromApi {
  id: string
  name: string
}

export function RevenuePage() {
  const { data: revenueData, loading, refetch } = useApiData<RevenueResponse>("/api/revenue")
  const [showForm, setShowForm] = useState(false)
  const { data: avatars } = useApiData<AvatarFromApi[]>("/api/avatars")

  const entries = revenueData?.entries || []
  const totals = revenueData?.totals || []

  const summary = useMemo(() => {
    const total = totals.reduce((sum, t) => sum + (t._sum.amount || 0), 0)
    const entryCount = entries.length

    // Group by source (server-side aggregate over all entries)
    const byType = Object.fromEntries((revenueData?.bySource || []).map((s) => [SOURCE_LABELS[s.source] || s.source, s.total])) as Record<string, number>

    // Top avatar
    const avatarMap = new Map<string, number>()
    for (const t of totals) {
      const name = avatars?.find((a) => a.id === t.avatarId)?.name || t.avatarId
      avatarMap.set(name, t._sum.amount || 0)
    }
    const topAvatar = [...avatarMap.entries()].sort((a, b) => b[1] - a[1])[0]

    return { total, entryCount, byType, topAvatar, avatarMap }
  }, [entries, totals, avatars, revenueData])

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
            label: "前月比",
            value: `${(revenueData?.monthlyGrowth ?? 0) > 0 ? "+" : ""}${revenueData?.monthlyGrowth ?? 0}%`,
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

      {/* Monthly trend */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">月次推移</h3>
          <button type="button" onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20">
            <Plus className="h-3 w-3" />収益を記録
          </button>
        </div>
        {showForm && <RevenueForm avatars={avatars || []} onSaved={async () => { setShowForm(false); await refetch() }} />}
        <div className="mt-4 flex h-40 items-end gap-3">
          {(revenueData?.monthly || []).map((m) => {
            const max = Math.max(...(revenueData?.monthly || []).map((x) => x.total), 1)
            return (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">¥{Math.round(m.total / 1000)}K</span>
                <div className="w-full rounded-t-md bg-gradient-to-t from-primary/40 to-primary" style={{ height: `${(m.total / max) * 110}px` }} />
                <span className="text-[10px] text-muted-foreground">{m.month.slice(2).replace("-", "/")}</span>
              </div>
            )
          })}
        </div>
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

function RevenueForm({ avatars, onSaved }: { avatars: AvatarFromApi[]; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ avatarId: avatars[0]?.id || "", type: "affiliate", amount: "", platform: "", description: "" })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    setError(null)
    const res = await fetch("/api/revenue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, avatarId: form.avatarId || avatars[0]?.id, amount: Number(form.amount), platform: form.platform || null }),
    })
    setSaving(false)
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "保存に失敗しました")
    await onSaved()
  }
  const cls = "rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none"
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-6">
      <select className={cls} value={form.avatarId} onChange={(e) => setForm({ ...form, avatarId: e.target.value })}>
        {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select className={cls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
        {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input className={cls} type="number" min={1} placeholder="金額 (円)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      <input className={cls} placeholder="プラットフォーム" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
      <input className={cls} placeholder="メモ" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <button type="button" disabled={saving || !form.amount} onClick={submit} className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">
        {saving ? "保存中…" : "記録"}
      </button>
      {error && <p className="text-xs text-destructive sm:col-span-6">{error}</p>}
    </div>
  )
}
