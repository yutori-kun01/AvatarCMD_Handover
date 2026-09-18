"use client"

import { useState } from "react"
import {
  Users,
  Activity,
  TrendingUp,
  Zap,
  Shield,
  BarChart3,
  Brain,
  Code,
  Heart,
  Flame,
  BookOpen,
  Pause,
  Play,
  MoreHorizontal,
  ExternalLink,
} from "lucide-react"

// ============================================
// Avatar Data
// ============================================

type AvatarRole =
  | "adhd_introvert"
  | "vibe_coder"
  | "wellness_coach"
  | "trend_hunter"
  | "knowledge_curator"

interface AvatarData {
  id: string
  name: string
  role: AvatarRole
  roleLabel: string
  status: "active" | "paused" | "learning"
  avatar: string
  platforms: string[]
  followers: string
  postsToday: number
  engagement: number
  revenue: string
  currentTask: string
  healthScore: number
  connections: string[]
}

const roleIcons: Record<AvatarRole, typeof Brain> = {
  adhd_introvert: Brain,
  vibe_coder: Code,
  wellness_coach: Heart,
  trend_hunter: Flame,
  knowledge_curator: BookOpen,
}

const roleColors: Record<AvatarRole, string> = {
  adhd_introvert: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  vibe_coder: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  wellness_coach: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  trend_hunter: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  knowledge_curator: "bg-pink-500/20 text-pink-400 border-pink-500/30",
}

const avatars: AvatarData[] = [
  {
    id: "1",
    name: "Haru",
    role: "adhd_introvert",
    roleLabel: "ADHD / 内向型",
    status: "active",
    avatar: "H",
    platforms: ["X", "note", "Threads"],
    followers: "12.4K",
    postsToday: 38,
    engagement: 4.7,
    revenue: "¥182K",
    currentTask: "X投稿: ADHD当事者の朝ルーティン",
    healthScore: 92,
    connections: ["Kai", "Mio"],
  },
  {
    id: "2",
    name: "Kai",
    role: "vibe_coder",
    roleLabel: "バイブコーダー",
    status: "active",
    avatar: "K",
    platforms: ["X", "Zenn", "YouTube"],
    followers: "8.7K",
    postsToday: 24,
    engagement: 5.2,
    revenue: "¥256K",
    currentTask: "Zenn記事: AIでアプリを作る方法",
    healthScore: 88,
    connections: ["Haru", "Ren"],
  },
  {
    id: "3",
    name: "Mio",
    role: "wellness_coach",
    roleLabel: "ウェルネスコーチ",
    status: "learning",
    avatar: "M",
    platforms: ["Instagram", "TikTok", "note"],
    followers: "23.1K",
    postsToday: 15,
    engagement: 6.1,
    revenue: "¥198K",
    currentTask: "新しいマインドフルネス知識を収集中",
    healthScore: 76,
    connections: ["Haru"],
  },
  {
    id: "4",
    name: "Ren",
    role: "trend_hunter",
    roleLabel: "トレンドハンター",
    status: "active",
    avatar: "R",
    platforms: ["X", "TikTok"],
    followers: "31.2K",
    postsToday: 52,
    engagement: 3.8,
    revenue: "¥124K",
    currentTask: "トレンド分析: AI最新ニュースまとめ",
    healthScore: 95,
    connections: ["Kai", "Sora"],
  },
  {
    id: "5",
    name: "Sora",
    role: "knowledge_curator",
    roleLabel: "知識キュレーター",
    status: "paused",
    avatar: "S",
    platforms: ["note", "Substack"],
    followers: "5.6K",
    postsToday: 3,
    engagement: 7.3,
    revenue: "¥87K",
    currentTask: "一時停止 - スケジュール調整中",
    healthScore: 60,
    connections: ["Ren"],
  },
]

const stats = [
  {
    label: "稼働中アバター",
    value: "3",
    sub: "/ 5 合計",
    change: "+1",
    positive: true,
    icon: Users,
    accentClass: "text-cyan-400",
    bgClass: "bg-cyan-500/10",
  },
  {
    label: "本日の投稿数",
    value: "132",
    sub: "件",
    change: "+23%",
    positive: true,
    icon: Activity,
    accentClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
  },
  {
    label: "月間収益",
    value: "¥847K",
    sub: "",
    change: "+18.2%",
    positive: true,
    icon: TrendingUp,
    accentClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
  },
  {
    label: "自動タスク実行",
    value: "1,284",
    sub: "件/日",
    change: "+156",
    positive: true,
    icon: Zap,
    accentClass: "text-purple-400",
    bgClass: "bg-purple-500/10",
  },
]

// ============================================
// Main Page
// ============================================

export default function DashboardPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="group rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 transition-all hover:border-cyan-500/30 hover:-translate-y-0.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">{stat.label}</span>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stat.bgClass}`}>
                <stat.icon className={`h-4 w-4 ${stat.accentClass}`} />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-2xl font-bold">{stat.value}</span>
              {stat.sub && (
                <span className="text-xs text-white/30">{stat.sub}</span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <span className={`text-xs font-medium ${stat.positive ? "text-emerald-400" : "text-red-400"}`}>
                {stat.change}
              </span>
              <span className="text-[10px] text-white/20">先週比</span>
            </div>
          </div>
        ))}
      </div>

      {/* Avatar Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">アバター一覧</h2>
          <span className="text-xs text-white/30">
            {avatars.filter((a) => a.status === "active").length}/{avatars.length} 稼働中
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {avatars.map((avatar) => {
            const RoleIcon = roleIcons[avatar.role]
            const isExpanded = expandedId === avatar.id
            const statusInfo = {
              active: { label: "稼働中", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
              paused: { label: "一時停止", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
              learning: { label: "学習中", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
            }[avatar.status]

            return (
              <div
                key={avatar.id}
                className={`group rounded-xl border bg-white/[0.03] p-4 transition-all hover:-translate-y-0.5 ${
                  isExpanded
                    ? "border-cyan-500/30"
                    : "border-white/[0.08] hover:border-white/[0.15]"
                }`}
              >
                {/* Top Row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold border ${roleColors[avatar.role]}`}>
                        {avatar.avatar}
                      </div>
                      {avatar.status === "active" && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b0c0f] bg-emerald-400" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{avatar.name}</span>
                        <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-medium ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-white/30">
                        <RoleIcon className="h-3 w-3" />
                        <span>{avatar.roleLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="rounded-md p-1.5 text-white/20 transition-colors hover:bg-white/[0.05] hover:text-white/50">
                      {avatar.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : avatar.id)}
                      className="rounded-md p-1.5 text-white/20 transition-colors hover:bg-white/[0.05] hover:text-white/50"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Current Task */}
                <div className="mt-3 rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2">
                  <p className="text-xs text-white/40">{avatar.currentTask}</p>
                </div>

                {/* Metrics Grid */}
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[
                    { v: avatar.followers, l: "フォロワー" },
                    { v: String(avatar.postsToday), l: "本日投稿" },
                    { v: `${avatar.engagement}%`, l: "エンゲージ" },
                    { v: avatar.revenue, l: "月間収益" },
                  ].map((m) => (
                    <div key={m.l} className="text-center">
                      <p className="text-xs font-semibold">{m.v}</p>
                      <p className="text-[9px] text-white/25">{m.l}</p>
                    </div>
                  ))}
                </div>

                {/* Health Bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-white/25">ヘルススコア</span>
                    <span className={`font-medium ${
                      avatar.healthScore >= 80 ? "text-emerald-400" : avatar.healthScore >= 60 ? "text-amber-400" : "text-red-400"
                    }`}>
                      {avatar.healthScore}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full rounded-full bg-white/[0.06]">
                    <div
                      className={`h-1 rounded-full transition-all ${
                        avatar.healthScore >= 80 ? "bg-emerald-500" : avatar.healthScore >= 60 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${avatar.healthScore}%` }}
                    />
                  </div>
                </div>

                {/* Platforms & Connections */}
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {avatar.platforms.map((p) => (
                      <span key={p} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-white/40">
                        {p}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-white/20">
                    <ExternalLink className="h-2.5 w-2.5" />
                    <span>{avatar.connections.join(", ")}</span>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-3 space-y-2 border-t border-white/[0.08] pt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="rounded-lg bg-cyan-500/10 px-3 py-2 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/20">
                        投稿履歴を見る
                      </button>
                      <button type="button" className="rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-xs text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/60">
                        設定を編集
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 bg-white/[0.03] border border-white/[0.08] rounded-xl space-y-4 hover:border-white/[0.15] transition-all">
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-cyan-400" />
            セキュリティステータス
          </h3>
          <div className="space-y-3">
            <StatusRow label="暗号化" status="AES-256-GCM ✓" ok />
            <StatusRow label="セッション分離" status="全プロファイル隔離済み" ok />
            <StatusRow label="APIトークン" status="5/5 有効" ok />
            <StatusRow label="最終監査" status="2分前" ok />
          </div>
        </div>
        <div className="p-5 bg-white/[0.03] border border-white/[0.08] rounded-xl space-y-4 hover:border-white/[0.15] transition-all">
          <h3 className="font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            改善サイクル
          </h3>
          <div className="space-y-3">
            <StatusRow label="データ収集" status="リアルタイム" ok />
            <StatusRow label="分析待ち" status="3件の改善提案" warn />
            <StatusRow label="A/Bテスト" status="2件進行中" ok />
            <StatusRow label="次回レポート" status="22:00 JST" ok />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusRow({ label, status, ok, warn }: { label: string; status: string; ok?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/30">{label}</span>
      <span className={warn ? "text-amber-400" : ok ? "text-emerald-400" : "text-white/50"}>
        {status}
      </span>
    </div>
  )
}
