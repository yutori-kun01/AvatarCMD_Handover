"use client"

import React from "react"

import { useState } from "react"
import {
  MoreHorizontal,
  Play,
  Pause,
  Brain,
  Code,
  Heart,
  Flame,
  BookOpen,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

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

const roleIcons: Record<AvatarRole, React.ComponentType<{ className?: string }>> = {
  adhd_introvert: Brain,
  vibe_coder: Code,
  wellness_coach: Heart,
  trend_hunter: Flame,
  knowledge_curator: BookOpen,
}

const roleColors: Record<AvatarRole, string> = {
  adhd_introvert: "bg-chart-4/20 text-chart-4 border-chart-4/30",
  vibe_coder: "bg-primary/20 text-primary border-primary/30",
  wellness_coach: "bg-accent/20 text-accent border-accent/30",
  trend_hunter: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  knowledge_curator: "bg-chart-5/20 text-chart-5 border-chart-5/30",
}

const statusLabels: Record<string, { label: string; className: string }> = {
  active: { label: "稼働中", className: "bg-accent/20 text-accent" },
  paused: { label: "一時停止", className: "bg-chart-3/20 text-chart-3" },
  learning: { label: "学習中", className: "bg-chart-4/20 text-chart-4" },
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

export function AvatarCards() {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          アバター一覧
        </h2>
        <span className="text-xs text-muted-foreground">
          {avatars.filter((a) => a.status === "active").length}/{avatars.length} 稼働中
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {avatars.map((avatar) => {
          const RoleIcon = roleIcons[avatar.role]
          const statusInfo = statusLabels[avatar.status]
          const isExpanded = expandedId === avatar.id
          return (
            <div
              key={avatar.id}
              className={cn(
                "group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20",
                isExpanded && "border-primary/30"
              )}
            >
              {/* Top Row */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold",
                        roleColors[avatar.role]
                      )}
                    >
                      {avatar.avatar}
                    </div>
                    {avatar.status === "active" && (
                      <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-accent" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {avatar.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn("h-5 text-[9px] font-medium", statusInfo.className)}
                      >
                        {statusInfo.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RoleIcon className="h-3 w-3" />
                      <span>{avatar.roleLabel}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {avatar.status === "active" ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : avatar.id)
                    }
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Current Task */}
              <div className="mt-3 rounded-lg bg-secondary px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {avatar.currentTask}
                </p>
              </div>

              {/* Metrics Grid */}
              <div className="mt-3 grid grid-cols-4 gap-2">
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">
                    {avatar.followers}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    フォロワー
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">
                    {avatar.postsToday}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    本日投稿
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">
                    {avatar.engagement}%
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    エンゲージ
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">
                    {avatar.revenue}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    月間収益
                  </p>
                </div>
              </div>

              {/* Health bar */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">ヘルススコア</span>
                  <span
                    className={cn(
                      "font-medium",
                      avatar.healthScore >= 80
                        ? "text-accent"
                        : avatar.healthScore >= 60
                          ? "text-chart-3"
                          : "text-destructive"
                    )}
                  >
                    {avatar.healthScore}%
                  </span>
                </div>
                <Progress
                  value={avatar.healthScore}
                  className="mt-1 h-1"
                />
              </div>

              {/* Platforms & Connections */}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {avatar.platforms.map((p) => (
                    <span
                      key={p}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                  <ExternalLink className="h-2.5 w-2.5" />
                  <span>{avatar.connections.join(", ")}</span>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/20"
                    >
                      投稿履歴を見る
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
                    >
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
  )
}
