"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Play,
  Pause,
  Settings,
  Brain,
  Code,
  Heart,
  Flame,
  BookOpen,
  TrendingUp,
  MessageSquare,
  ExternalLink,
  BarChart3,
  Clock,
  ChevronUp,
  Edit3,
  Trash2,
  Copy,
  X,
  Save,
  Loader2,
  Plus,
  Link2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApiData, useApiMutation } from "@/hooks/use-api"

type AvatarRole =
  | "adhd_introvert"
  | "vibe_coder"
  | "wellness_coach"
  | "trend_hunter"
  | "knowledge_curator"

interface AvatarFromApi {
  id: string
  name: string
  role: string
  roleKey: string | null
  specialization: string
  targetAudience: string
  tone: string | null
  description: string | null
  status: string
  avatarImageUrl: string | null
  createdAt: string
  platforms?: { id: string; platform: string; handle: string; followerCount: number; hasCredentials?: boolean }[]
  _count?: { posts: number; revenue: number; knowledge: number; automations: number }
}

interface PostFromApi {
  id: string
  content: string
  platform: string
  status: string
  publishedAt: string | null
  createdAt: string
  engagementData?: { likes?: number; retweets?: number; impressions?: number } | null
}

const roleIcons: Record<string, typeof Brain> = {
  adhd_introvert: Brain,
  vibe_coder: Code,
  wellness_coach: Heart,
  trend_hunter: Flame,
  knowledge_curator: BookOpen,
}

const roleColors: Record<string, string> = {
  adhd_introvert: "#a78bfa",
  vibe_coder: "#22d3ee",
  wellness_coach: "#34d399",
  trend_hunter: "#fbbf24",
  knowledge_curator: "#f472b6",
}

const roleLabels: Record<string, string> = {
  adhd_introvert: "ADHD / 内向型",
  vibe_coder: "バイブコーダー",
  wellness_coach: "ウェルネスコーチ",
  trend_hunter: "トレンドハンター",
  knowledge_curator: "知識キュレーター",
}

const statusLabels: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "稼働中", className: "bg-accent/20 text-accent" },
  PAUSED: { label: "一時停止", className: "bg-[#fbbf24]/20 text-[#fbbf24]" },
  LEARNING: { label: "学習中", className: "bg-[#a78bfa]/20 text-[#a78bfa]" },
  ERROR: { label: "エラー", className: "bg-destructive/20 text-destructive" },
}

// ─── Edit Modal ─────────────────────────────────────────
function EditAvatarModal({
  avatar,
  onClose,
  onSaved,
}: {
  avatar?: AvatarFromApi
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: avatar?.name ?? "",
    role: avatar?.role ?? "",
    specialization: avatar?.specialization ?? "",
    targetAudience: avatar?.targetAudience ?? "",
    tone: avatar?.tone || "",
    description: avatar?.description || "",
  })
  const { mutate, loading, error } = useApiMutation<typeof form>(avatar ? `/api/avatars/${avatar.id}` : "/api/avatars", avatar ? "PATCH" : "POST")

  const handleSave = async () => {
    if (!form.name.trim() || !form.role.trim()) return
    const result = await mutate(form)
    if (result) {
      onSaved()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">{avatar ? "アバターを編集" : "新規アバターを作成"}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {[
            { key: "name", label: "名前 *" },
            { key: "role", label: "ロール *（例: ADHD / 内向型）" },
            { key: "specialization", label: "専門領域" },
            { key: "targetAudience", label: "ターゲット" },
            { key: "tone", label: "トーン" },
          ].map((field) => (
            <div key={field.key}>
              <label className="text-xs text-muted-foreground">{field.label}</label>
              <input
                type="text"
                value={(form as Record<string, string>)[field.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-muted-foreground">説明</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="mt-1 h-24 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
            />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        {!avatar && <p className="mt-3 text-[10px] text-muted-foreground">作成直後は「一時停止」状態です。人格ファイル(soul.md)を調整してから起動してください。</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────
export function AvatarsPage() {
  const { data: avatarsData, loading, refetch } = useApiData<AvatarFromApi[]>("/api/avatars")
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("id")
  const setSelectedId = (id: string | null) => router.push(id ? `/dashboard/avatars?id=${id}` : "/dashboard/avatars")
  const [editingAvatar, setEditingAvatar] = useState<AvatarFromApi | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (searchParams.get("new") === "1") setCreating(true)
  }, [searchParams])

  const avatars = avatarsData || []

  // Dynamic summary
  const summary = useMemo(() => {
    const total = avatars.length
    const active = avatars.filter((a) => a.status === "ACTIVE").length
    const paused = avatars.filter((a) => a.status === "PAUSED").length
    const maintenance = avatars.filter((a) => a.status === "LEARNING" || a.status === "ERROR").length
    return { total, active, paused, maintenance }
  }, [avatars])

  const selectedAvatar = avatars.find((a) => a.id === selectedId)

  if (selectedAvatar) {
    return (
      <AvatarDetailView
        avatar={selectedAvatar}
        allAvatars={avatars}
        onBack={() => setSelectedId(null)}
        onRefresh={refetch}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Edit Modal */}
      {editingAvatar && (
        <EditAvatarModal
          avatar={editingAvatar}
          onClose={() => setEditingAvatar(null)}
          onSaved={refetch}
        />
      )}

      {creating && (
        <EditAvatarModal
          onClose={() => {
            setCreating(false)
            if (searchParams.get("new")) router.replace("/dashboard/avatars")
          }}
          onSaved={refetch}
        />
      )}

      <div className="flex justify-end">
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20">
          <Plus className="h-3 w-3" />
          新規アバター
        </button>
      </div>

      {/* Summary Bar — dynamic from API */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "合計アバター", value: summary.total.toString(), color: "text-foreground" },
          { label: "稼働中", value: summary.active.toString(), color: "text-accent" },
          { label: "一時停止", value: summary.paused.toString(), color: "text-[#fbbf24]" },
          { label: "学習中/エラー", value: summary.maintenance.toString(), color: "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Avatar List */}
      <div className="space-y-3">
        {avatars.map((avatar) => {
          const role = (avatar.roleKey ?? "") as AvatarRole
          const RoleIcon = roleIcons[role] || Brain
          const color = roleColors[role] || "#a78bfa"
          const statusInfo = statusLabels[avatar.status] || statusLabels.ACTIVE
          const totalFollowers = avatar.platforms?.reduce((sum, p) => sum + (p.followerCount || 0), 0) || 0
          const totalPosts = avatar._count?.posts || 0

          return (
            <div
              key={avatar.id}
              className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                {/* Left: Avatar info */}
                <div
                  className="flex flex-1 items-center gap-4"
                  onClick={() => setSelectedId(avatar.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(avatar.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="relative">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold"
                      style={{ backgroundColor: `${color}20`, color }}
                    >
                      {avatar.name.charAt(0)}
                    </div>
                    {avatar.status === "ACTIVE" && (
                      <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-accent" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-foreground">{avatar.name}</span>
                      <Badge variant="outline" className={cn("h-5 text-[10px] font-medium", statusInfo.className)}>
                        {statusInfo.label}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RoleIcon className="h-3 w-3" />
                      <span>{avatar.role}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{avatar.description || avatar.specialization}</p>
                  </div>
                </div>

                {/* Right: Metrics + Actions */}
                <div className="flex flex-wrap items-center gap-4 lg:gap-6">
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">{totalFollowers.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">フォロワー</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">{totalPosts}</p>
                    <p className="text-[10px] text-muted-foreground">投稿数</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">{avatar._count?.knowledge || 0}</p>
                    <p className="text-[10px] text-muted-foreground">知識</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">{avatar._count?.automations || 0}</p>
                    <p className="text-[10px] text-muted-foreground">自動化</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingAvatar(avatar)
                      }}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      title="編集"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <ExternalLink
                      className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
                      onClick={() => setSelectedId(avatar.id)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Detail View ────────────────────────────────────────
function AvatarDetailView({
  avatar,
  allAvatars,
  onBack,
  onRefresh,
}: {
  avatar: AvatarFromApi
  allAvatars: AvatarFromApi[]
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const role = (avatar.roleKey ?? "") as AvatarRole
  const RoleIcon = roleIcons[role] || Brain
  const color = roleColors[role] || "#a78bfa"
  const statusInfo = statusLabels[avatar.status] || statusLabels.ACTIVE
  const [editModal, setEditModal] = useState(false)
  const { mutate: updateStatus, loading: statusLoading } = useApiMutation<{ status: string }>(
    `/api/avatars/${avatar.id}`,
    "PATCH"
  )
  const { mutate: cloneAvatar, loading: cloneLoading } = useApiMutation<Partial<AvatarFromApi>>(
    "/api/avatars",
    "POST"
  )
  const { mutate: deleteAvatar, loading: deleteLoading } = useApiMutation<undefined>(`/api/avatars/${avatar.id}`, "DELETE")
  const handleDelete = async () => {
    if (!window.confirm(`アバター「${avatar.name}」を削除します。投稿・収益・人格ファイルなど関連データもすべて削除されます。よろしいですか？`)) return
    const result = await deleteAvatar()
    if (result) {
      await onRefresh()
      onBack()
    }
  }

  // Fetch posts for this avatar
  const { data: avatarPosts } = useApiData<PostFromApi[]>(`/api/posts?avatarId=${avatar.id}`)

  const handleToggleStatus = async () => {
    const newStatus = avatar.status === "ACTIVE" ? "PAUSED" : "ACTIVE"
    const result = await updateStatus({ status: newStatus })
    if (result) await onRefresh()
  }

  const handleClone = async () => {
    const result = await cloneAvatar({
      name: `${avatar.name} (コピー)`,
      role: avatar.role,
      specialization: avatar.specialization,
      targetAudience: avatar.targetAudience,
      tone: avatar.tone,
      description: avatar.description,
    })
    if (result) await onRefresh()
  }

  const totalFollowers = avatar.platforms?.reduce((sum, p) => sum + (p.followerCount || 0), 0) || 0
  const totalPosts = avatar._count?.posts || 0

  return (
    <div className="space-y-6">
      {/* Edit Modal */}
      {editModal && (
        <EditAvatarModal
          avatar={avatar}
          onClose={() => setEditModal(false)}
          onSaved={onRefresh}
        />
      )}

      {/* Back + Title */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronUp className="h-4 w-4 rotate-[-90deg]" />
        <span>アバター一覧に戻る</span>
      </button>

      {/* Profile Header */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-5">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-2xl text-2xl font-bold"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {avatar.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-foreground">{avatar.name}</h2>
                <Badge variant="outline" className={cn("h-6 text-xs font-medium", statusInfo.className)}>
                  {statusInfo.label}
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <RoleIcon className="h-4 w-4" />
                <span>{avatar.role}</span>
              </div>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                {avatar.description || avatar.specialization}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {avatar.platforms?.map((p) => (
                  <span key={p.platform} className="rounded-full bg-secondary px-2.5 py-1 text-[10px] text-muted-foreground">
                    {p.platform} {p.handle ? `@${p.handle}` : ""}{p.hasCredentials ? " 🔑" : ""}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleToggleStatus}
              disabled={statusLoading}
              className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-4 py-2 text-xs text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {statusLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : avatar.status === "ACTIVE" ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {avatar.status === "ACTIVE" ? "一時停止" : "起動"}
            </button>
            <button
              type="button"
              onClick={() => setEditModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Edit3 className="h-3.5 w-3.5" />
              編集
            </button>
            <button
              type="button"
              onClick={handleClone}
              disabled={cloneLoading}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {cloneLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              複製
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteLoading}
              className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-4 py-2 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              削除
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-5 bg-secondary">
          <TabsTrigger value="overview">概要</TabsTrigger>
          <TabsTrigger value="soul">人格 (Files)</TabsTrigger>
          <TabsTrigger value="posts">投稿履歴</TabsTrigger>
          <TabsTrigger value="config">設定</TabsTrigger>
          <TabsTrigger value="analytics">分析</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Metrics */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">パフォーマンス指標</h3>
              <div className="mt-4 space-y-4">
                {[
                  { label: "フォロワー数", value: totalFollowers.toLocaleString(), icon: TrendingUp },
                  { label: "総投稿数", value: `${totalPosts.toLocaleString()}件`, icon: MessageSquare },
                  { label: "知識アイテム", value: `${avatar._count?.knowledge || 0}件`, icon: BookOpen },
                  { label: "自動化ルール", value: `${avatar._count?.automations || 0}件`, icon: BarChart3 },
                  { label: "収益記録", value: `${avatar._count?.revenue || 0}件`, icon: TrendingUp },
                ].map((m) => (
                  <div key={m.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <m.icon className="h-3.5 w-3.5" />
                      <span>{m.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{m.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* System Info */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">システム情報</h3>
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">作成日</span>
                  <span className="text-foreground">{new Date(avatar.createdAt).toLocaleDateString("ja-JP")}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">トーン</span>
                  <span className="text-foreground">{avatar.tone || "未設定"}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">ターゲット</span>
                  <span className="text-foreground">{avatar.targetAudience}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">プラットフォーム</span>
                  <div className="flex gap-1">
                    {avatar.platforms?.map((p) => (
                      <span key={p.platform} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{p.platform}</span>
                    )) || <span className="text-muted-foreground">なし</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Connections */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">コネクション</h3>
              <div className="mt-4 space-y-3">
                {allAvatars
                  .filter((a) => a.id !== avatar.id)
                  .slice(0, 4)
                  .map((conn) => {
                    const connRole = (conn.roleKey ?? "") as AvatarRole
                    const connColor = roleColors[connRole] || "#a78bfa"
                    const connStatusInfo = statusLabels[conn.status] || statusLabels.ACTIVE
                    return (
                      <div key={conn.id} className="flex items-center gap-3 rounded-lg bg-secondary p-3">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                          style={{ backgroundColor: `${connColor}20`, color: connColor }}
                        >
                          {conn.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-medium text-foreground">{conn.name}</p>
                          <p className="text-[10px] text-muted-foreground">{conn.role}</p>
                        </div>
                        <Badge variant="outline" className={cn("h-4 text-[9px]", connStatusInfo.className)}>
                          {connStatusInfo.label}
                        </Badge>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="posts" className="space-y-3">
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold text-foreground">投稿履歴（実データ）</h3>
            </div>
            <div className="divide-y divide-border">
              {avatarPosts && avatarPosts.length > 0 ? (
                avatarPosts.map((post) => (
                  <div key={post.id} className="flex items-start gap-4 px-5 py-4">
                    <span className="rounded bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">{post.platform}</span>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{post.content}</p>
                      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <Badge variant="outline" className={cn("h-4 text-[9px]",
                          post.status === "PUBLISHED" ? "bg-accent/20 text-accent" :
                          post.status === "FAILED" ? "bg-destructive/20 text-destructive" :
                          "bg-primary/20 text-primary"
                        )}>
                          {post.status}
                        </Badge>
                        <span>{new Date(post.createdAt).toLocaleDateString("ja-JP")}</span>
                        {post.engagementData && (
                          <span>{(post.engagementData as { likes?: number }).likes || 0} いいね</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  まだ投稿がありません
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="soul" className="space-y-4">
          <AvatarFilesTab avatarId={avatar.id} />
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <AvatarConfigTab avatarId={avatar.id} avatarStatus={avatar.status} onRefresh={onRefresh} />
        </TabsContent>

        <TabsContent value="analytics">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">分析概要</h3>
            <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { label: "総投稿数", value: totalPosts.toLocaleString(), sub: "全期間" },
                { label: "フォロワー計", value: totalFollowers.toLocaleString(), sub: "全プラットフォーム" },
                { label: "知識ベース", value: `${avatar._count?.knowledge || 0}`, sub: "アイテム" },
                { label: "自動化", value: `${avatar._count?.automations || 0}`, sub: "ルール数" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg bg-secondary p-4 text-center">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 text-lg font-bold text-foreground">{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground">{stat.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Config Tab with persistent toggles ─────────────────
function AvatarConfigTab({
  avatarId,
  avatarStatus,
  onRefresh,
}: {
  avatarId: string
  avatarStatus: string
  onRefresh: () => Promise<void>
}) {
  const { data: automations, refetch: refetchAuto } = useApiData<{ id: string; name: string; status: string }[]>(
    `/api/automations?avatarId=${avatarId}`
  )

  const handleToggle = async (autoId: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE"
    try {
      await fetch(`/api/automations/${autoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      await refetchAuto()
    } catch (e) {
      console.error("Failed to toggle automation:", e)
    }
  }

  return (
    <div className="space-y-4">
    <AccountsManager avatarId={avatarId} onChanged={onRefresh} />
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">自動化ルール設定</h3>
      <div className="mt-4 space-y-5">
        {automations && automations.length > 0 ? (
          automations.map((auto) => (
            <div key={auto.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">{auto.name}</p>
                <p className="text-xs text-muted-foreground">
                  ステータス: {auto.status === "ACTIVE" ? "有効" : auto.status === "PAUSED" ? "停止中" : "エラー"}
                </p>
              </div>
              <Switch
                checked={auto.status === "ACTIVE"}
                onCheckedChange={() => handleToggle(auto.id, auto.status)}
              />
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">このアバターに自動化ルールはまだ設定されていません</p>
        )}
      </div>
    </div>
    </div>
  )
}

// ─── SNS Accounts (credentials encrypted server-side) ───
interface AccountFromApi {
  id: string
  platform: string
  accountName: string
  authType: string
  followerCount: number | null
  hasAccessToken: boolean
}

function AccountsManager({ avatarId, onChanged }: { avatarId: string; onChanged: () => Promise<void> }) {
  const { data: accounts, refetch } = useApiData<AccountFromApi[]>(`/api/avatars/${avatarId}/accounts`)
  const [form, setForm] = useState({ platform: "x", accountName: "", accessToken: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    if (!form.accountName) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/avatars/${avatarId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: form.platform, accountName: form.accountName, accessToken: form.accessToken || undefined }),
    })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "保存に失敗しました")
    else {
      setForm({ platform: form.platform, accountName: "", accessToken: "" })
      await Promise.all([refetch(), onChanged()])
    }
    setSaving(false)
  }

  const remove = async (id: string) => {
    if (!window.confirm("このアカウント連携を解除しますか？")) return
    await fetch(`/api/sns-accounts/${id}`, { method: "DELETE" })
    await Promise.all([refetch(), onChanged()])
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Link2 className="h-4 w-4" />SNSアカウント連携</h3>
      <p className="mt-1 text-[10px] text-muted-foreground">アクセストークンは AES-256-GCM で暗号化して保存され、画面には表示されません。</p>
      <div className="mt-4 space-y-2">
        {(accounts || []).map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-xs">
            <span className="text-foreground">{a.platform} · {a.accountName}</span>
            <span className="flex items-center gap-3 text-muted-foreground">
              {a.hasAccessToken ? "トークン設定済み" : "トークン未設定"}
              <button type="button" onClick={() => remove(a.id)} className="text-muted-foreground hover:text-destructive" title="連携解除"><Trash2 className="h-3.5 w-3.5" /></button>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none">
          {["x", "threads", "instagram", "youtube", "facebook", "linkedin", "reddit", "bluesky", "wordpress", "note", "tiktok", "zenn", "medium", "substack", "ameba", "standfm"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} placeholder="@handle" className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none" />
        <input type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} placeholder="アクセストークン（任意）" className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none" />
        <button type="button" onClick={add} disabled={saving || !form.accountName} className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}追加
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ─── Avatar Files Edit Tab ──────────────────────────────
function AvatarFilesTab({ avatarId }: { avatarId: string }) {
  const { data: files, refetch, loading } = useApiData<{ filename: string; content: string }[]>(
    `/api/avatars/${avatarId}/files`
  )
  const [selectedFile, setSelectedFile] = useState<string>("soul.md")
  const [content, setContent] = useState<string>("")
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Update editor content when active file changes
  const handleSelectFile = useCallback(
    (filename: string) => {
      setSelectedFile(filename)
      const file = files?.find((f) => f.filename === filename)
      if (file) {
        setContent(file.content)
        setIsDirty(false)
      }
    },
    [files]
  )

  // Initialize content on first load
  if (files && !content && !isDirty) {
    const file = files.find((f) => f.filename === selectedFile)
    if (file) setContent(file.content)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/avatars/${avatarId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: selectedFile, content }),
      })
      if (res.ok) {
        setIsDirty(false)
        setSaveError(null)
        await refetch()
      } else {
        setSaveError((await res.json().catch(() => ({}))).error || "保存に失敗しました")
      }
    } catch (e) {
      console.error("Failed to save file", e)
    } finally {
      setIsSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex gap-2">
          {["soul.md", "identity.md", "rules.md"].map((f) => (
            <button
              key={f}
              onClick={() => handleSelectFile(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                selectedFile === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存
        </button>
      </div>
      {saveError && <p className="border-b border-border px-5 py-2 text-xs text-destructive">{saveError}</p>}
      <div className="p-0">
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setIsDirty(true)
          }}
          className="min-h-[400px] w-full resize-y bg-[#0d1117] p-5 font-mono text-sm text-[#c9d1d9] focus:outline-none"
          spellCheck={false}
          placeholder="ファイル内容がありません"
        />
      </div>
    </div>
  )
}
