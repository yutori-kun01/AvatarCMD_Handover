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
          scheduledAt: !immediate && newPost.scheduledAt ? newPost.scheduledAt : undefined,
        }),
      })
      setNewPost({ avatarId: "", platform: "", content: "", scheduledAt: "" })
      await refetchPosts()
    } catch (e) {
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
          payload: { avatarId: newPost.avatarId, data: { topic: newPost.content || "日々の気づき" } },
        }),
      })
      // Clear content after triggering
      setNewPost((prev) => ({ ...prev, content: "" }))
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
        <TabsList className="grid w-full max-w-md grid-cols-3 bg-secondary">
          <TabsTrigger value="schedule">配信予定</TabsTrigger>
          <TabsTrigger value="published">配信済み</TabsTrigger>
          <TabsTrigger value="compose">新規作成</TabsTrigger>
        </TabsList>

        {/* Scheduled */}
        <TabsContent value="schedule" className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">配信予定 / 下書き</h3>
          <div className="space-y-2">
            {posts
              .filter((p) => p.status === "SCHEDULED" || p.status === "DRAFT")
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
                    </div>
                    <div className="flex gap-1">
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
                  {["X", "NOTE", "ZENN", "INSTAGRAM", "YOUTUBE", "TIKTOK"].map((p) => (
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
      </Tabs>
    </div>
  )
}
