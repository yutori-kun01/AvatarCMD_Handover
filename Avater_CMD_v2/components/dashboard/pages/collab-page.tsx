"use client"

import { useState } from "react"
import {
  ArrowRight,
  Plus,
  CheckCircle2,
  Clock,
  PauseCircle,
  Trash2,
  Edit3,
  Loader2,
  X,
  Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useApiData } from "@/hooks/use-api"

interface CollabFromApi {
  id: string
  initiatorId: string
  partnerId: string
  title: string
  description: string | null
  status: string
  platform: string | null
  startDate: string | null
  endDate: string | null
  createdAt: string
  initiator: { id: string; name: string; role: string }
  partner: { id: string; name: string; role: string }
}

interface AvatarFromApi {
  id: string
  name: string
  role: string
}

const statusConfig: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  PROPOSED: { label: "承認待ち", className: "bg-[#fbbf24]/20 text-[#fbbf24]", icon: Clock },
  IN_PROGRESS: { label: "稼働中", className: "bg-accent/20 text-accent", icon: CheckCircle2 },
  COMPLETED: { label: "完了", className: "bg-primary/20 text-primary", icon: CheckCircle2 },
  CANCELLED: { label: "キャンセル", className: "bg-muted text-muted-foreground", icon: PauseCircle },
}

const roleColors: Record<string, string> = {
  adhd_introvert: "#a78bfa",
  vibe_coder: "#22d3ee",
  wellness_coach: "#34d399",
  trend_hunter: "#fbbf24",
  knowledge_curator: "#f472b6",
}

// ─── Create Modal ───────────────────────────────────────
function CreateCollabModal({
  avatars,
  onClose,
  onSaved,
}: {
  avatars: AvatarFromApi[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    initiatorId: avatars[0]?.id || "",
    partnerId: avatars[1]?.id || "",
    title: "",
    description: "",
  })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.initiatorId || !form.partnerId || !form.title) return
    setLoading(true)
    try {
      await fetch("/api/collaborations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      onSaved()
      onClose()
    } catch (e) {
      console.error("Failed to create collab:", e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">新規コラボレーション</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">発案者</label>
              <select value={form.initiatorId}
                onChange={(e) => setForm((prev) => ({ ...prev, initiatorId: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none">
                {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">パートナー</label>
              <select value={form.partnerId}
                onChange={(e) => setForm((prev) => ({ ...prev, partnerId: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none">
                {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">タイトル</label>
            <input type="text" value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">説明</label>
            <textarea value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="mt-1 h-20 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground">キャンセル</button>
          <button type="button" onClick={handleSave} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            作成
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────
export function CollabPage() {
  const { data: collabs, refetch } = useApiData<CollabFromApi[]>("/api/collaborations")
  const { data: avatars } = useApiData<AvatarFromApi[]>("/api/avatars")
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const collaborations = collabs || []
  const activeCount = collaborations.filter((c) => c.status === "IN_PROGRESS").length
  const proposedCount = collaborations.filter((c) => c.status === "PROPOSED").length

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await fetch(`/api/collaborations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      await refetch()
    } catch (e) {
      console.error("Failed to update:", e)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/collaborations/${id}`, { method: "DELETE" })
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
        <CreateCollabModal avatars={avatars || []} onClose={() => setShowModal(false)} onSaved={refetch} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "稼働中", value: activeCount.toString(), color: "text-accent" },
          { label: "承認待ち", value: proposedCount.toString(), color: "text-[#fbbf24]" },
          { label: "完了", value: collaborations.filter((c) => c.status === "COMPLETED").length.toString(), color: "text-primary" },
          { label: "合計", value: collaborations.length.toString(), color: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">コラボレーション一覧</h3>
        <button type="button" onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20">
          <Plus className="h-3 w-3" />
          新規コラボ
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {collaborations.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">コラボレーションがありません</div>
        )}
        {collaborations.map((collab) => {
          const sc = statusConfig[collab.status] || statusConfig.PROPOSED
          const StatusIcon = sc.icon
          const srcColor = roleColors[collab.initiator.role] || "#a78bfa"
          const tgtColor = roleColors[collab.partner.role] || "#22d3ee"
          return (
            <div key={collab.id} className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/20">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{collab.title}</h4>
                    <Badge variant="outline" className={cn("h-5 text-[9px]", sc.className)}>
                      <StatusIcon className="mr-1 h-2.5 w-2.5" />
                      {sc.label}
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: srcColor }} />
                      <span className="text-xs font-medium text-foreground">{collab.initiator.name}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: tgtColor }} />
                      <span className="text-xs font-medium text-foreground">{collab.partner.name}</span>
                    </div>
                  </div>
                  {collab.description && <p className="mt-2 text-xs text-muted-foreground">{collab.description}</p>}
                </div>

                <div className="flex items-center gap-4">
                  {collab.status === "PROPOSED" && (
                    <button type="button" onClick={() => handleStatusChange(collab.id, "IN_PROGRESS")}
                      className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20">
                      承認
                    </button>
                  )}
                  {collab.status === "IN_PROGRESS" && (
                    <button type="button" onClick={() => handleStatusChange(collab.id, "COMPLETED")}
                      className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20">
                      完了
                    </button>
                  )}
                  <button type="button" onClick={() => handleDelete(collab.id)} disabled={deletingId === collab.id}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-50">
                    {deletingId === collab.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
