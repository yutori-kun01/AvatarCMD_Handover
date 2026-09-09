"use client"

import React from "react"

import {
  Send,
  BookOpen,
  DollarSign,
  Share2,
  Brain,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ActivityType = "post" | "learn" | "revenue" | "collab" | "knowledge" | "alert"

interface ActivityItem {
  id: string
  type: ActivityType
  avatar: string
  avatarName: string
  message: string
  time: string
  detail?: string
}

const activityIcons: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  post: Send,
  learn: BookOpen,
  revenue: DollarSign,
  collab: Share2,
  knowledge: Brain,
  alert: AlertTriangle,
}

const activityColors: Record<ActivityType, string> = {
  post: "bg-primary/10 text-primary",
  learn: "bg-chart-4/10 text-chart-4",
  revenue: "bg-accent/10 text-accent",
  collab: "bg-chart-5/10 text-chart-5",
  knowledge: "bg-chart-3/10 text-chart-3",
  alert: "bg-destructive/10 text-destructive",
}

const activities: ActivityItem[] = [
  {
    id: "1",
    type: "post",
    avatar: "H",
    avatarName: "Haru",
    message: "Xに新規投稿を配信しました",
    time: "2分前",
    detail: "「ADHDの私が見つけた集中法5選」 - いいね 142件",
  },
  {
    id: "2",
    type: "collab",
    avatar: "K",
    avatarName: "Kai",
    message: "HaruとKaiがコラボ投稿を生成中",
    time: "8分前",
    detail: "テーマ: ADHDエンジニアのためのAI活用術",
  },
  {
    id: "3",
    type: "revenue",
    avatar: "R",
    avatarName: "Ren",
    message: "アフィリエイト収益が発生しました",
    time: "15分前",
    detail: "+¥4,200 TikTokアフィリエイト経由",
  },
  {
    id: "4",
    type: "knowledge",
    avatar: "M",
    avatarName: "Mio",
    message: "新しい知識ソースを取り込み完了",
    time: "23分前",
    detail: "マインドフルネス関連論文 12件を処理",
  },
  {
    id: "5",
    type: "alert",
    avatar: "S",
    avatarName: "Sora",
    message: "投稿スケジュールの調整が必要です",
    time: "45分前",
    detail: "APIレート制限に近づいています",
  },
  {
    id: "6",
    type: "post",
    avatar: "K",
    avatarName: "Kai",
    message: "Zennに技術記事を公開しました",
    time: "1時間前",
    detail: "「非エンジニアがv0でSaaSを作った話」 - スクラップ 23件",
  },
  {
    id: "7",
    type: "learn",
    avatar: "R",
    avatarName: "Ren",
    message: "トレンド分析モデルを更新しました",
    time: "1.5時間前",
    detail: "精度が2.3%向上",
  },
]

export function ActivityFeed() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          リアルタイムアクティビティ
        </h3>
        <button
          type="button"
          className="text-xs text-primary transition-colors hover:text-primary/80"
        >
          すべて表示
        </button>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {activities.map((activity, index) => {
          const Icon = activityIcons[activity.type]
          return (
            <div
              key={activity.id}
              className={cn(
                "flex gap-3 px-4 py-3 transition-colors hover:bg-secondary/50",
                index < activities.length - 1 && "border-b border-border/50"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  activityColors[activity.type]
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {activity.avatarName}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {activity.time}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activity.message}
                </p>
                {activity.detail && (
                  <p className="mt-1 rounded bg-secondary/50 px-2 py-1 text-[10px] text-muted-foreground">
                    {activity.detail}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
