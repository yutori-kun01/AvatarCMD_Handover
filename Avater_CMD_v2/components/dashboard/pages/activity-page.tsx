"use client"

import { useState, useMemo } from "react"
import {
  Send,
  BookOpen,
  DollarSign,
  Share2,
  Brain,
  AlertTriangle,
  Search,
  Clock,
  RefreshCw,
  Loader2,
  X,
  Eye,
  FileText,
  Cpu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useApiData } from "@/hooks/use-api"

type ActivityType = "post" | "learn" | "revenue" | "collab" | "knowledge" | "alert"

interface ActivityFromApi {
  id: string
  type: string
  title: string
  description: string | null
  metadata?: string | null
  createdAt: string
  avatar?: { id: string; name: string; avatarImageUrl: string | null } | null
}

const typeMapping: Record<string, ActivityType> = {
  post_created: "post",
  post_deleted: "post",
  post_published: "post",
  automation_started: "post",
  automation_completed: "post",
  revenue_earned: "revenue",
  collab_created: "collab",
  collab_started: "collab",
  knowledge_added: "knowledge",
  knowledge_update: "knowledge",
  success: "knowledge",
  error: "alert",
  automation_created: "knowledge",
  automation_deleted: "knowledge",
  alert: "alert",
  learn: "learn",
}

const activityIcons: Record<ActivityType, typeof Send> = {
  post: Send,
  learn: BookOpen,
  revenue: DollarSign,
  collab: Share2,
  knowledge: Brain,
  alert: AlertTriangle,
}

const activityColors: Record<ActivityType, string> = {
  post: "bg-primary/10 text-primary",
  learn: "bg-[#a78bfa]/10 text-[#a78bfa]",
  revenue: "bg-accent/10 text-accent",
  collab: "bg-[#f472b6]/10 text-[#f472b6]",
  knowledge: "bg-[#fbbf24]/10 text-[#fbbf24]",
  alert: "bg-destructive/10 text-destructive",
}

const typeLabels: Record<ActivityType, string> = {
  post: "投稿",
  learn: "学習",
  revenue: "収益",
  collab: "コラボ",
  knowledge: "知識",
  alert: "アラート",
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "たった今"
  if (mins < 60) return `${mins}分前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}時間前`
  return `${Math.floor(hours / 24)}日前`
}

function resolveType(rawType: string): ActivityType {
  return typeMapping[rawType] || "knowledge"
}

function parseMetadata(raw?: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ─── Artifact Inspector Overlay ─────────────────────
function InspectorOverlay({
  activity,
  onClose,
}: {
  activity: ActivityFromApi
  onClose: () => void
}) {
  const type = resolveType(activity.type)
  const Icon = activityIcons[type]
  const metadata = parseMetadata(activity.metadata)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", activityColors[type])}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Artifact Inspector</h3>
              <p className="text-[10px] text-muted-foreground">{activity.id}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground">タイプ</p>
              <p className="mt-1 text-sm font-medium text-foreground">{activity.type}</p>
            </div>
            <div className="rounded-xl bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground">タイムスタンプ</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {new Date(activity.createdAt).toLocaleString("ja-JP")}
              </p>
            </div>
            <div className="rounded-xl bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground">アバター</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {activity.avatar?.name || "システム"}
              </p>
            </div>
            <div className="rounded-xl bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground">カテゴリ</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={cn("rounded-full px-2 py-0.5 text-[9px]", activityColors[type])}>
                  {typeLabels[type]}
                </span>
              </div>
            </div>
          </div>

          {/* Title & Description */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" />
              タイトル & 説明
            </div>
            <p className="mt-2 text-sm font-semibold text-foreground">{activity.title}</p>
            {activity.description && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-secondary/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {activity.description}
              </p>
            )}
          </div>

          {/* Metadata (LLM Artifact) */}
          {metadata && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-xs text-primary">
                <Cpu className="h-3 w-3" />
                LLM 実行メタデータ
              </div>
              <div className="mt-3 space-y-2">
                {Object.entries(metadata).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-4">
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {key}
                    </span>
                    <span className="text-right text-xs text-foreground break-all">
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No metadata fallback */}
          {!metadata && (
            <div className="rounded-xl border border-border bg-secondary/20 p-4 text-center">
              <Cpu className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">
                このアクティビティにはメタデータが記録されていません
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────
export function ActivityPage() {
  const { data: apiActivities, refetch, loading } = useApiData<ActivityFromApi[]>("/api/activity")
  const [filter, setFilter] = useState<ActivityType | "all">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [inspecting, setInspecting] = useState<ActivityFromApi | null>(null)

  const activities = apiActivities || []

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      const type = resolveType(a.type)
      const matchesType = filter === "all" || type === filter
      const matchesSearch =
        searchQuery === "" ||
        a.title.includes(searchQuery) ||
        (a.description?.includes(searchQuery) ?? false) ||
        (a.avatar?.name?.includes(searchQuery) ?? false)
      return matchesType && matchesSearch
    })
  }, [activities, filter, searchQuery])

  const typeCounts = useMemo(() => {
    return activities.reduce(
      (acc, a) => {
        const type = resolveType(a.type)
        acc[type] = (acc[type] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
  }, [activities])

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  return (
    <div className="space-y-6">
      {/* Inspector Overlay */}
      {inspecting && (
        <InspectorOverlay activity={inspecting} onClose={() => setInspecting(null)} />
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(["post", "learn", "revenue", "collab", "knowledge", "alert"] as ActivityType[]).map((type) => {
          const Icon = activityIcons[type]
          return (
            <button
              key={type}
              type="button"
              onClick={() => setFilter(filter === type ? "all" : type)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 transition-all",
                filter === type ? "border-primary/40 bg-primary/5" : "hover:border-primary/20"
              )}
            >
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", activityColors[type])}>
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-xs text-muted-foreground">{typeLabels[type]}</span>
              <span className="text-lg font-bold text-foreground">{typeCounts[type] || 0}</span>
            </button>
          )
        })}
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 border border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="アクティビティを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs text-muted-foreground">
            <Clock className="mr-1 h-3 w-3" />
            {activities.length} 件
          </Badge>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            更新
          </button>
        </div>
      </div>

      {/* Activity List */}
      <div className="rounded-xl border border-border bg-card">
        <div className="divide-y divide-border">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {!loading && filtered.map((activity) => {
            const type = resolveType(activity.type)
            const Icon = activityIcons[type]
            return (
              <button
                key={activity.id}
                type="button"
                onClick={() => setInspecting(activity)}
                className="flex w-full gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/30 group"
              >
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", activityColors[type])}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {activity.avatar && (
                      <>
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground">
                          {activity.avatar.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-foreground">{activity.avatar.name}</span>
                      </>
                    )}
                    <span className="text-[10px] text-muted-foreground">{timeAgo(activity.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{activity.title}</p>
                  {activity.description && (
                    <p className="mt-1.5 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground line-clamp-2">{activity.description}</p>
                  )}
                </div>
                <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            )
          })}
          {!loading && filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              アクティビティがありません
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
