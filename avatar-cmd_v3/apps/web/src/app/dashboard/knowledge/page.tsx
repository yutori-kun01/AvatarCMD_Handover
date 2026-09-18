"use client"

import { useState, useMemo } from "react"
import {
  BookOpen,
  Database,
  FileText,
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  X,
  Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useApiData } from "@/hooks/use-api"

interface KnowledgeFromApi {
  id: string
  avatarId: string
  title: string
  content: string
  category: string | null
  tags: string[]
  sourceUrl: string | null
  createdAt: string
  updatedAt: string
  avatar?: { id: string; name: string }
}

interface KnowledgeResponse {
  items: KnowledgeFromApi[]
  totalCount: number
  categories: { category: string | null; _count: number }[]
}

interface AvatarFromApi {
  id: string
  name: string
}

// ─── Add Knowledge Modal ────────────────────────────────
function AddKnowledgeModal({
  avatars,
  onClose,
  onSaved,
}: {
  avatars: AvatarFromApi[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    avatarId: avatars[0]?.id || "",
    title: "",
    content: "",
    category: "",
    sourceUrl: "",
    tags: "",
  })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.avatarId || !form.title || (!form.content && !form.sourceUrl)) return
    setLoading(true)
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      })
      onSaved()
      onClose()
    } catch (e) {
      console.error("Failed to add knowledge:", e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">知識アイテムを追加</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">アバター</label>
            <select
              value={form.avatarId}
              onChange={(e) => setForm((prev) => ({ ...prev, avatarId: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none"
            >
              {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">タイトル</label>
            <input type="text" value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">内容</label>
            <textarea value={form.content}
              onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
              className="mt-1 h-24 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">カテゴリ</label>
              <input type="text" value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">タグ (,区切り)</label>
              <input type="text" value={form.tags}
                onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">ソースURL</label>
            <input type="url" value={form.sourceUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, sourceUrl: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground">キャンセル</button>
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

// ─── Main Page ──────────────────────────────────────────
export default function KnowledgePage() {
  const { data: knowledgeResp, refetch } = useApiData<KnowledgeResponse>("/api/knowledge")
  const { data: avatars } = useApiData<AvatarFromApi[]>("/api/avatars")
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const items = knowledgeResp?.items || []
  const totalCount = knowledgeResp?.totalCount || 0
  const categories = knowledgeResp?.categories || []

  const filtered = filterCategory
    ? items.filter((i) => i.category === filterCategory)
    : items

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/knowledge/${id}`, { method: "DELETE" })
      await refetch()
    } catch (e) {
      console.error("Failed to delete:", e)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {showModal && (
        <AddKnowledgeModal avatars={avatars || []} onClose={() => setShowModal(false)} onSaved={refetch} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "総アイテム数", value: totalCount.toString(), color: "text-primary" },
          { label: "カテゴリ数", value: categories.length.toString(), color: "text-accent" },
          { label: "アバター数", value: (avatars?.length || 0).toString(), color: "text-foreground" },
          { label: "最新追加", value: items[0] ? new Date(items[0].createdAt).toLocaleDateString("ja-JP") : "-", color: "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter & Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setFilterCategory(null)}
            className={cn("rounded-lg px-3 py-1.5 text-xs transition-colors",
              !filterCategory ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground")}>
            すべて
          </button>
          {categories.map((c) => (
            <button key={c.category || "none"} type="button"
              onClick={() => setFilterCategory(c.category)}
              className={cn("rounded-lg px-3 py-1.5 text-xs transition-colors",
                filterCategory === c.category ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground")}>
              {c.category || "未分類"} ({c._count})
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20">
          <Plus className="h-3 w-3" />
          アイテム追加
        </button>
      </div>

      {/* Items List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">知識アイテムがありません</div>
        )}
        {filtered.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
                    {item.category && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] text-primary">{item.category}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.content}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {item.avatar?.name || "不明"}
                    </span>
                    {item.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">{tag}</span>
                    ))}
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleDateString("ja-JP")}
                    </span>
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => handleDelete(item.id)} disabled={deletingId === item.id}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-50">
                {deletingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
