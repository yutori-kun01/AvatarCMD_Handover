"use client"

import { useState, useMemo, useCallback } from "react"
import {
  Calendar,
  Clock,
  Edit3,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  Trash2,
  Plus,
  CheckCircle2,
  Timer,
  AlertCircle,
  X,
  Loader2,
  Send,
  Save,
  Sparkles,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApiData, useApiMutation } from "@/hooks/use-api"

interface PostFromApi {
  id: string
  avatarId: string
  content: string
  platform: string
  status: string
  scheduledAt: string | null
  publishedAt: string | null
  postUrl?: string | null
  lastError?: string | null
  generatedBy?: string | null
  createdAt: string
  engagementData?: { likes?: number; comments?: number; shares?: number; views?: number } | null
  avatar?: { id: string; name: string; avatarImageUrl: string | null }
}

interface AvatarFromApi {
  id: string
  name: string
  platforms?: { platform: string; followerCount: number }[]
}

const statusConfig: Record<string, { label: string; className: string; icon: typeof Timer }> = {
  DRAFT: { label: "下書き", className: "bg-muted text-muted-foreground", icon: Edit3 },
  SCHEDULED: { label: "配信予定", className: "bg-primary/20 text-primary", icon: Timer },
  PUBLISHING: { label: "配信中", className: "bg-[#fbbf24]/20 text-[#fbbf24]", icon: Loader2 },
  PUBLISHED: { label: "配信済み", className: "bg-accent/20 text-accent", icon: CheckCircle2 },
  FAILED: { label: "失敗", className: "bg-destructive/20 text-destructive", icon: AlertCircle },
}

// ─── Edit Post Modal ────────────────────────────────────
function EditPostModal({
  post,
  onClose,
  onSaved,
}: {
  post: PostFromApi
  onClose: () => void
  onSaved: () => void
}) {
  const [content, setContent] = useState(post.content)
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    setLoading(true)
    try {
      await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      onSaved()
      onClose()
    } catch (e) {
      console.error("Failed to update post:", e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">投稿を編集</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-secondary px-1.5 py-0.5">{post.platform}</span>
          <span>{post.avatar?.name}</span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="mt-3 h-32 w-full rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-foreground focus:border-primary/40 focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground">
            キャンセル
          </button>
          <button type="button" onClick={handleSave} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main SNS Page ──────────────────────────────────────
export function SnsPage() {
  const { data: apiPosts, refetch: refetchPosts } = useApiData<PostFromApi[]>("/api/posts")
  const { data: avatars } = useApiData<AvatarFromApi[]>("/api/avatars")
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [editingPost, setEditingPost] = useState<PostFromApi | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ─── New Post Form State ─────
  const [newPost, setNewPost] = useState({
    avatarId: "",
    platform: "",
    content: "",
    scheduledAt: "",
  })
  const [posting, setPosting] = useState(false)

  const posts = apiPosts || []

  // Platform stats from avatars
  const platformStats = useMemo(() => {
    if (!avatars) return []
    const map = new Map<string, { followers: number; avatars: string[] }>()
    for (const av of avatars) {
      for (const p of av.platforms || []) {
        const existing = map.get(p.platform) || { followers: 0, avatars: [] }
        existing.followers += p.followerCount || 0
        existing.avatars.push(av.name)
        map.set(p.platform, existing)
      }
    }
    const postsByPlatform = posts.reduce((acc, p) => {
      acc[p.platform] = (acc[p.platform] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return Array.from(map.entries()).map(([platform, data]) => ({
      platform,
      followers: data.followers,
      posts: postsByPlatform[platform] || 0,
      topAvatar: data.avatars[0] || "",
    }))
  }, [avatars, posts])

  // Publish now (enqueue publish_post job)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const handlePublish = async (id: string) => {
    setPublishingId(id)
    const res = await fetch(`/api/posts/${id}/publish`, { method: "POST" })
    setNotice(res.ok ? "配信ジョブをキューに追加しました" : (await res.json().catch(() => ({}))).error || "配信に失敗しました")
    setTimeout(async () => {
      await refetchPosts()
      setPublishingId(null)
    }, 1500)
  }

  // Delete post
  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/posts/${id}`, { method: "DELETE" })
      await refetchPosts()
    } catch (e) {
      console.error("Failed to delete post:", e)
    } finally {
      setDeletingId(null)
    }
  }

  // Create post
  const handleCreatePost = async (immediate: boolean) => {
    if (!newPost.avatarId || !newPost.platform || !newPost.content) return
    setPosting(true)
    try {
      await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarId: newPost.avatarId,
          platform: newPost.platform,
          content: newPost.content,
          status: immediate ? "PUBLISHED" : "SCHEDULED",
          scheduledAt: !immediate && newPost.scheduledAt ? new Date(newPost.scheduledAt).toISOString() : undefined,
        }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
        setNotice(immediate ? "投稿を作成し、配信ジョブを追加しました" : "投稿を予約しました")
      })
      setNewPost({ avatarId: "", platform: "", content: "", scheduledAt: "" })
      await refetchPosts()
    } catch (e) {
      setNotice((e as Error).message)
      console.error("Failed to create post:", e)
    } finally {
      setPosting(false)
    }
  }

  // Trigger AI Generation via Saga Orchestrator
  const [generating, setGenerating] = useState(false)
  const handleGenerateByAI = async () => {
    if (!newPost.avatarId) return
    setGenerating(true)
    try {
      await fetch("/api/queue/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "generate_post",
          payload: { avatarId: newPost.avatarId, data: { topic: newPost.content || "日々の気づき", platform: (newPost.platform || "x").toLowerCase() } },
        }),
      })
      // Clear content after triggering
      setNewPost((prev) => ({ ...prev, content: "" }))
      setNotice("AI生成ジョブを追加しました。数秒後に「配信予定 / 下書き」に表示されます")
      // Trigger a refetch after a short delay to hope the generation is done
      setTimeout(refetchPosts, 3500)
    } catch (e) {
      console.error("Failed to trigger AI generation:", e)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Edit Modal */}
      {editingPost && (
        <EditPostModal post={editingPost} onClose={() => setEditingPost(null)} onSaved={refetchPosts} />
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-xs text-primary">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Platform Cards — dynamic */}
      {platformStats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {platformStats.map((p) => (
            <button
              key={p.platform}
              type="button"
              onClick={() => setSelectedPlatform(selectedPlatform === p.platform ? null : p.platform)}
              className={cn(
                "rounded-xl border border-border bg-card p-4 text-left transition-all",
                selectedPlatform === p.platform ? "border-primary/40 bg-primary/5" : "hover:border-primary/20"
              )}
            >
              <span className="text-xs font-medium text-foreground">{p.platform}</span>
              <p className="mt-2 text-xl font-bold text-foreground">{p.followers.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">フォロワー</p>
              <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{p.posts}件投稿</span>
                <span>{p.topAvatar}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Tabs defaultValue="schedule" className="space-y-4">
        <TabsList className="grid w-full max-w-lg grid-cols-4 bg-secondary">
          <TabsTrigger value="schedule">配信予定</TabsTrigger>
          <TabsTrigger value="published">配信済み</TabsTrigger>
          <TabsTrigger value="compose">新規作成</TabsTrigger>
          <TabsTrigger value="platforms">プラットフォーム</TabsTrigger>
        </TabsList>

        {/* Scheduled */}
        <TabsContent value="schedule" className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">配信予定 / 下書き</h3>
          <div className="space-y-2">
            {posts
              .filter((p) => p.status === "SCHEDULED" || p.status === "DRAFT" || p.status === "PUBLISHING")
              .filter((p) => !selectedPlatform || p.platform === selectedPlatform)
              .map((post) => {
                const sc = statusConfig[post.status] || statusConfig.DRAFT
                const StatusIcon = sc.icon
                return (
                  <div key={post.id} className="flex gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/20">
                    <div className="flex flex-col items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">
                        {post.scheduledAt
                          ? new Date(post.scheduledAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                          : "--:--"}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{post.avatar?.name || "?"}</span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">{post.platform}</span>
                        <Badge variant="outline" className={cn("h-5 text-[9px]", sc.className)}>
                          <StatusIcon className="mr-1 h-2.5 w-2.5" />
                          {sc.label}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{post.content}</p>
                      {post.generatedBy && <p className="mt-1 text-[10px] text-indigo-400">AI生成: {post.generatedBy}</p>}
                    </div>
                    <div className="flex gap-1">
                      {post.status !== "PUBLISHING" && (
                        <button type="button" onClick={() => handlePublish(post.id)} disabled={publishingId === post.id} title="今すぐ配信"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-accent disabled:opacity-50">
                          {publishingId === post.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <button type="button" onClick={() => setEditingPost(post)}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => handleDelete(post.id)}
                        disabled={deletingId === post.id}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-50">
                        {deletingId === post.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            {posts.filter((p) => p.status === "SCHEDULED" || p.status === "DRAFT").length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">配信予定の投稿はありません</div>
            )}
          </div>
        </TabsContent>

        {/* Published */}
        <TabsContent value="published" className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">配信済み / 失敗</h3>
          <div className="space-y-2">
            {posts
              .filter((p) => p.status === "PUBLISHED" || p.status === "FAILED")
              .filter((p) => !selectedPlatform || p.platform === selectedPlatform)
              .map((post) => {
                const sc = statusConfig[post.status] || statusConfig.PUBLISHED
                const StatusIcon = sc.icon
                const eng = post.engagementData as { likes?: number; comments?: number; shares?: number; views?: number } | null
                return (
                  <div key={post.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{post.avatar?.name || "?"}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">{post.platform}</span>
                      <Badge variant="outline" className={cn("h-5 text-[9px]", sc.className)}>
                        <StatusIcon className="mr-1 h-2.5 w-2.5" />
                        {sc.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("ja-JP") : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{post.content}</p>
                    {post.status === "FAILED" && post.lastError && <p className="mt-1 text-[10px] text-destructive">エラー: {post.lastError}</p>}
                    {post.postUrl && (
                      <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                        <ExternalLink className="h-2.5 w-2.5" /> 投稿を開く
                      </a>
                    )}
                    {eng && (
                      <div className="mt-3 flex items-center gap-5">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Heart className="h-3 w-3" /> {eng.likes || 0}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><MessageCircle className="h-3 w-3" /> {eng.comments || 0}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Repeat2 className="h-3 w-3" /> {eng.shares || 0}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Eye className="h-3 w-3" /> {(eng.views || 0).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            {posts.filter((p) => p.status === "PUBLISHED" || p.status === "FAILED").length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">配信済みの投稿はありません</div>
            )}
          </div>
        </TabsContent>

        {/* Compose — fully functional */}
        <TabsContent value="compose">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold text-foreground">新規投稿を作成</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground">アバターを選択</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {(avatars || []).map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => setNewPost((prev) => ({ ...prev, avatarId: av.id }))}
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs transition-colors",
                        newPost.avatarId === av.id
                          ? "bg-primary/20 text-primary border border-primary/40"
                          : "bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      )}
                    >
                      {av.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">プラットフォーム</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {["x", "threads", "note", "zenn", "instagram", "youtube", "tiktok", "bluesky", "linkedin"].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewPost((prev) => ({ ...prev, platform: p }))}
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs transition-colors",
                        newPost.platform === p
                          ? "bg-primary/20 text-primary border border-primary/40"
                          : "bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">投稿内容</label>
                <textarea
                  value={newPost.content}
                  onChange={(e) => setNewPost((prev) => ({ ...prev, content: e.target.value }))}
                  placeholder="投稿内容を入力..."
                  className="mt-1.5 h-32 w-full rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">配信日時（任意）</label>
                <input
                  type="datetime-local"
                  value={newPost.scheduledAt}
                  onChange={(e) => setNewPost((prev) => ({ ...prev, scheduledAt: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleCreatePost(true)}
                  disabled={posting || !newPost.avatarId || !newPost.platform || !newPost.content}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  手動で即時配信
                </button>
                <button
                  type="button"
                  onClick={() => handleCreatePost(false)}
                  disabled={posting || !newPost.avatarId || !newPost.platform || !newPost.content}
                  className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  手動でスケジュール
                </button>
                
                {/* AI / Saga Orchestrator Integration */}
                <div className="ml-auto flex items-center gap-3 border-l border-border pl-4">
                  <p className="text-[10px] text-muted-foreground hidden sm:block">
                    ※トピックを「投稿内容」に書いてAI生成できます
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerateByAI}
                    disabled={generating || !newPost.avatarId}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-4 py-2 text-sm text-indigo-400 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Saga: AI自動生成
                  </button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="platforms">
          <PlatformsPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── 16 platform providers (integrations registry) ─────
interface PlatformInfo {
  platform: string
  displayName: string
  icon: string
  authType: string
  modes: string[]
  maxPostLength: number
  connectedAccounts: number
  followers: number
}

function PlatformsPanel() {
  const { data } = useApiData<{ totalPlatforms: number; hybridCount: number; apiCount: number; browserCount: number; platforms: PlatformInfo[] }>("/api/platforms")
  if (!data) return <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "対応プラットフォーム", v: data.totalPlatforms },
          { l: "ハイブリッド (API+Browser)", v: data.hybridCount },
          { l: "API対応", v: data.apiCount },
          { l: "ブラウザのみ", v: data.browserCount },
        ].map((x) => (
          <div key={x.l} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{x.l}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{x.v}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.platforms.map((p) => (
          <div key={p.platform} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">{p.icon}</span>
              <span className="text-sm font-semibold text-foreground">{p.displayName}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.modes.map((m) => (
                <span key={m} className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">{m}</span>
              ))}
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">{p.authType}</span>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              連携 {p.connectedAccounts} アカウント · {p.followers.toLocaleString()} フォロワー · 最大 {p.maxPostLength.toLocaleString()} 文字
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
