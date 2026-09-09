"use client"

import { Users, TrendingUp, MessageSquare, Zap } from "lucide-react"

const stats = [
  {
    label: "稼働中アバター",
    value: "5",
    sub: "/ 8 合計",
    change: "+2",
    positive: true,
    icon: Users,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    label: "本日の投稿数",
    value: "142",
    sub: "件",
    change: "+23%",
    positive: true,
    icon: MessageSquare,
    color: "text-accent",
    bgColor: "bg-accent/10",
  },
  {
    label: "月間収益",
    value: "¥847K",
    sub: "",
    change: "+18.2%",
    positive: true,
    icon: TrendingUp,
    color: "text-chart-3",
    bgColor: "bg-chart-3/10",
  },
  {
    label: "自動タスク実行",
    value: "1,284",
    sub: "件/日",
    change: "+156",
    positive: true,
    icon: Zap,
    color: "text-chart-4",
    bgColor: "bg-chart-4/10",
  },
]

export function StatsCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{stat.label}</span>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-bold text-foreground">
              {stat.value}
            </span>
            {stat.sub && (
              <span className="text-xs text-muted-foreground">{stat.sub}</span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span
              className={`text-xs font-medium ${
                stat.positive ? "text-accent" : "text-destructive"
              }`}
            >
              {stat.change}
            </span>
            <span className="text-[10px] text-muted-foreground">先週比</span>
          </div>
        </div>
      ))}
    </div>
  )
}
