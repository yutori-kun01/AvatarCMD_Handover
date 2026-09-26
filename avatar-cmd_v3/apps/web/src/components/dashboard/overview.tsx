"use client"

import Link from "next/link"
import { useState } from "react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar, Cell } from "recharts"
import { Users, MessageSquare, TrendingUp, Zap, Brain, Code, Heart, Flame, BookOpen, Pause, Play, Loader2, Sparkles, Share2, ArrowRight, Lightbulb } from "lucide-react"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Badge } from "@/components/ui/badge"
import { useApiData } from "@/hooks/use-api"
import { cn } from "@/lib/utils"

interface DashboardAvatar {
  id: string
  name: string
  role: string
  roleKey: string | null
  status: string
  description: string | null
  moodScore: number
  revenueMonth: number
  engagementRate: number
  healthScore: number
  platforms: { platform: string; followerCount: number }[]
  _count?: { posts: number }
}

interface DashboardData {
  stats: {
    activeAvatars: number
    totalAvatars: number
    postsToday: number
    postsChange: number
    revenueMonth: number
    revenueChange: number
    automationsWeek: number
    automationsChange: number
  }
  avatars: DashboardAvatar[]
  engagementTrend: Record<string, number | string>[]
  collaborations: { id: string; initiatorId: string; partnerId: string; title: string; status: string }[]
  activity: { id: string; type: string; title: string; level: string; createdAt: string; avatar: { name: string } | null }[]
  improvements: { id: string; avatarName: string; suggestions: { title: string; description: string; impact: string }[] }[]
  queue: { backend: string; pending: number; processing: number; failed: number } | null
}

export const ROLE_STYLE: Record<string, { color: string; icon: typeof Brain }> = {
  adhd_introvert: { color: "#a78bfa", icon: Brain },
  vibe_coder: { color: "#22d3ee", icon: Code },
  wellness_coach: { color: "#34d399", icon: Heart },
  trend_hunter: { color: "#fbbf24", icon: Flame },
  knowledge_curator: { color: "#f472b6", icon: BookOpen },
}
const FALLBACK_COLORS = ["#a78bfa", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#f87171"]

export function avatarColor(a: { roleKey: string | null }, i: number) {
  return (a.roleKey && ROLE_STYLE[a.roleKey]?.color) || FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

const STATUS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "稼働中", className: "bg-accent/20 text-accent border-accent/30" },
  PAUSED: { label: "一時停止", className: "bg-[#fbbf24]/20 text-[#fbbf24] border-[#fbbf24]/30" },
  LEARNING: { label: "学習中", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  ERROR: { label: "エラー", className: "bg-destructive/20 text-destructive border-destructive/30" },
}

const yen = (n: number) => (n >= 10000 ? `¥${Math.round(n / 1000).toLocaleString()}K` : `¥${Math.round(n).toLocaleString()}`)
const signed = (n: number, suffix = "%") => `${n > 0 ? "+" : ""}${n}${suffix}`

export function Overview() {
  const { data, loading, error, refetch } = useApiData<DashboardData>("/api/dashboard")
  const [busyId, setBusyId] = useState<string | null>(null)

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }
  if (error || !data) return <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">読み込みに失敗しました: {error}</div>

  const { stats } = data
  const avatarNames = data.avatars.map((a) => a.name)

  const toggle = async (a: DashboardAvatar) => {
    setBusyId(a.id)
    await fetch(`/api/avatars/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: a.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }),
    })
    await refetch()
    setBusyId(null)
  }

  const generate = async (a: DashboardAvatar) => {
    setBusyId(a.id)
    await fetch("/api/queue/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "generate_post", payload: { avatarId: a.id, data: { topic: "日々の気づき" } } }),
    })
    setTimeout(async () => {
      await refetch()
      setBusyId(null)
    }, 2500)
  }

  const cards = [
    { label: "稼働中アバター", value: String(stats.activeAvatars), sub: `/ ${stats.totalAvatars} 合計`, change: null, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { label: "本日の投稿・生成", value: String(stats.postsToday), sub: "件", change: signed(stats.postsChange), positive: stats.postsChange >= 0, icon: MessageSquare, color: "text-accent", bg: "bg-accent/10" },
    { label: "今月の収益", value: yen(stats.revenueMonth), sub: "", change: signed(stats.revenueChange), positive: stats.revenueChange >= 0, icon: TrendingUp, color: "text-chart-3", bg: "bg-chart-3/10" },
    { label: "自動タスク実行", value: String(stats.automationsWeek), sub: "件/週", change: signed(stats.automationsChange), positive: stats.automationsChange >= 0, icon: Zap, color: "text-chart-4", bg: "bg-chart-4/10" },
  ]

  const chartConfig = Object.fromEntries(data.avatars.map((a, i) => [a.name, { label: a.name, color: avatarColor(a, i) }]))

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", c.bg)}>
                <c.icon className={cn("h-4 w-4", c.color)} />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-2xl font-bold">{c.value}</span>
              {c.sub && <span className="text-xs text-muted-foreground">{c.sub}</span>}
            </div>
            {c.change && (
              <div className="mt-2 flex items-center gap-1">
                <span className={cn("text-xs font-medium", c.positive ? "text-accent" : "text-destructive")}>{c.change}</span>
                <span className="text-[10px] text-muted-foreground">前期間比</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">エンゲージメント推移（14日）</h3>
          </div>
          <div className="p-4">
            {data.engagementTrend.length ? (
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <AreaChart data={data.engagementTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" width={40} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {avatarNames.map((name, i) => (
                    <Area key={name} type="monotone" dataKey={name} stackId="1" stroke={avatarColor(data.avatars[i], i)} fill={avatarColor(data.avatars[i], i)} fillOpacity={0.15} />
                  ))}
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">分析データがまだありません</p>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">今月のアバター別収益</h3>
          </div>
          <div className="p-4">
            <ChartContainer config={{ revenue: { label: "収益", color: "#22d3ee" } }} className="h-[220px] w-full">
              <BarChart data={data.avatars.map((a) => ({ name: a.name, revenue: a.revenueMonth }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" />
                <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" width={50} tickFormatter={(v) => yen(Number(v))} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                  {data.avatars.map((a, i) => (
                    <Cell key={a.id} fill={avatarColor(a, i)} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      </div>

      {/* Avatar cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">アバター一覧</h2>
          <Link href="/dashboard/avatars" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            すべて表示 <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {data.avatars.map((a, i) => {
            const color = avatarColor(a, i)
            const Icon = (a.roleKey && ROLE_STYLE[a.roleKey]?.icon) || Brain
            const st = STATUS[a.status] ?? STATUS.ACTIVE
            const followers = a.platforms.reduce((s, p) => s + p.followerCount, 0)
            return (
              <div key={a.id} className="rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.15]">
                <div className="flex items-start justify-between">
                  <Link href={`/dashboard/avatars?id=${a.id}`} className="flex items-center gap-3">
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold" style={{ backgroundColor: `${color}20`, color, borderColor: `${color}40` }}>
                        {a.name.charAt(0)}
                      </div>
                      {a.status === "ACTIVE" && <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-400" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{a.name}</span>
                        <Badge variant="outline" className={cn("h-4 px-1.5 text-[9px]", st.className)}>{st.label}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon className="h-3 w-3" />
                        <span>{a.role}</span>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1">
                    <button type="button" title="AIで投稿を生成" onClick={() => generate(a)} disabled={busyId === a.id} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-indigo-400 disabled:opacity-50">
                      {busyId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" title={a.status === "ACTIVE" ? "一時停止" : "起動"} onClick={() => toggle(a)} disabled={busyId === a.id} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground disabled:opacity-50">
                      {a.status === "ACTIVE" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[
                    { v: followers >= 1000 ? `${(followers / 1000).toFixed(1)}K` : String(followers), l: "フォロワー" },
                    { v: String(a._count?.posts ?? 0), l: "投稿" },
                    { v: `${a.engagementRate}%`, l: "エンゲージ" },
                    { v: yen(a.revenueMonth), l: "今月収益" },
                  ].map((m) => (
                    <div key={m.l} className="text-center">
                      <p className="text-xs font-semibold">{m.v}</p>
                      <p className="text-[9px] text-muted-foreground">{m.l}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">ヘルス / ムード</span>
                    <span className="text-muted-foreground">{a.healthScore}% / {Math.round(a.moodScore * 100)}</span>
                  </div>
                  <div className="mt-1 h-1 w-full rounded-full bg-white/[0.06]">
                    <div className={cn("h-1 rounded-full", a.healthScore >= 80 ? "bg-emerald-500" : a.healthScore >= 60 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${a.healthScore}%` }} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {a.platforms.map((p) => (
                    <span key={p.platform} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-muted-foreground">{p.platform}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Collabs / Improvements / Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Share2 className="h-4 w-4 text-primary" />進行中のコラボ</h3>
          <div className="mt-3 space-y-2">
            {data.collaborations.length === 0 && <p className="text-xs text-muted-foreground">進行中のコラボはありません</p>}
            {data.collaborations.map((c) => {
              const from = data.avatars.find((a) => a.id === c.initiatorId)
              const to = data.avatars.find((a) => a.id === c.partnerId)
              return (
                <div key={c.id} className="rounded-lg bg-secondary/60 p-3">
                  <p className="text-xs font-medium">{c.title}</p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    {from?.name} <ArrowRight className="h-2.5 w-2.5" /> {to?.name}
                    <span className="ml-auto">{c.status === "IN_PROGRESS" ? "進行中" : "提案中"}</span>
                  </p>
                </div>
              )
            })}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-amber-400" />改善提案</h3>
          <div className="mt-3 space-y-2">
            {data.improvements.length === 0 && <p className="text-xs text-muted-foreground">未対応の改善提案はありません</p>}
            {data.improvements.flatMap((c) =>
              (Array.isArray(c.suggestions) ? c.suggestions : []).map((s, i) => (
                <div key={`${c.id}-${i}`} className="rounded-lg bg-secondary/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{s.title}</span>
                    <span className="ml-auto text-[9px] text-muted-foreground">{c.avatarName}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{s.description}</p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">最新アクティビティ</h3>
            <Link href="/dashboard/activity" className="text-[10px] text-muted-foreground hover:text-primary">すべて</Link>
          </div>
          <div className="mt-3 space-y-2">
            {data.activity.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2">
                <div className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", ev.level === "error" ? "bg-destructive" : ev.level === "warning" ? "bg-amber-400" : ev.level === "success" ? "bg-accent" : "bg-primary")} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs">{ev.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {ev.avatar?.name ?? "system"} · {new Date(ev.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {data.queue && (
            <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">
              ジョブキュー ({data.queue.backend}): 待機 {data.queue.pending} / 実行中 {data.queue.processing} / 失敗 {data.queue.failed}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
