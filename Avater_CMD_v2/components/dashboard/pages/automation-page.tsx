"use client"

import { useState, useMemo } from "react"
import {
  Plus,
  Edit3,
  Trash2,
  ArrowRight,
  Send,
  Brain,
  TrendingUp,
  DollarSign,
  Shield,
  Loader2,
  X,
  Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useApiData } from "@/hooks/use-api"

interface AutomationFromApi {
  id: string
  avatarId: string
  name: string
  description: string | null
  trigger: string
  action: string
  config: unknown
  status: string
  lastRunAt: string | null
  createdAt: string
  avatar?: { id: string; name: string }
}

interface AvatarFromApi {
  id: string
  name: string
}

const categoryFromTrigger = (trigger: string): string => {
  if (trigger.includes("schedule") || trigger.includes("毎")) return "posting"
  if (trigger.includes("知識") || trigger.includes("論文")) return "knowledge"
  if (trigger.includes("収益") || trigger.includes("アフィ")) return "monetize"
  if (trigger.includes("安全") || trigger.includes("API")) return "safety"
  return "analytics"
}

const categoryConfig: Record<string, { label: string; icon: typeof Send; color: string }> = {
  posting: { label: "投稿自動化", icon: Send, color: "bg-primary/10 text-primary" },
  knowledge: { label: "知識収集", icon: Brain, color: "bg-[#a78bfa]/10 text-[#a78bfa]" },
  monetize: { label: "マネタイズ", icon: DollarSign, color: "bg-accent/10 text-accent" },
  safety: { label: "安全管理", icon: Shield, color: "bg-destructive/10 text-destructive" },
  analytics: { label: "分析", icon: TrendingUp, color: "bg-[#fbbf24]/10 text-[#fbbf24]" },
}

// ─── Create/Edit Modal ──────────────────────────────────
function AutomationModal({
  automation,
  avatars,
  onClose,
  onSaved,
}: {
  automation?: AutomationFromApi
  avatars: AvatarFromApi[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    avatarId: automation?.avatarId || (avatars[0]?.id || ""),
    name: automation?.name || "",
    description: automation?.description || "",
    trigger: automation?.trigger || "",
    action: automation?.action || "",
  })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.avatarId || !form.name || !form.trigger || !form.action) return
    setLoading(true)
    try {
      const url = automation ? `/api/automations/${automation.id}` : "/api/automations"
      const method = automation ? "PATCH" : "POST"
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      onSaved()
      onClose()
    } catch (e) {
      console.error("Failed to save automation:", e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {automation ? "ルールを編集" : "新規ルール追加"}
          </h3>
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
              {avatars.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          {[
            { key: "name", label: "ルール名" },
            { key: "trigger", label: "トリガー" },
            { key: "action", label: "アクション" },
          ].map((field) => (
            <div key={field.key}>
              <label className="text-xs text-muted-foreground">{field.label}</label>
              <input
                type="text"
                value={(form as Record<string, string>)[field.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none"
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-muted-foreground">説明</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="mt-1 h-20 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
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

// ─── Main Page ──────────────────────────────────────────
export function AutomationPage() {
  const { data: automations, refetch } = useApiData<AutomationFromApi[]>("/api/automations")
  const { data: avatars } = useApiData<AvatarFromApi[]>("/api/avatars")
  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<AutomationFromApi | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const rules = automations || []
  const activeCount = rules.filter((r) => r.status === "ACTIVE").length

  const handleToggle = async (id: string, currentStatus: string) => {
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE" }),
      })
      await refetch()
    } catch (e) {
      console.error("Failed to toggle:", e)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/automations/${id}`, { method: "DELETE" })
      await refetch()
    } catch (e) {
      console.error("Failed to delete:", e)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Modal */}
      {(showModal || editingRule) && (
        <AutomationModal
          automation={editingRule || undefined}
          avatars={avatars || []}
          onClose={() => { setShowModal(false); setEditingRule(null) }}
          onSaved={refetch}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "合計ルール", value: rules.length.toString(), color: "text-foreground" },
          { label: "有効", value: activeCount.toString(), color: "text-accent" },
          { label: "無効", value: (rules.length - activeCount).toString(), color: "text-muted-foreground" },
          { label: "エラー", value: rules.filter((r) => r.status === "ERROR").length.toString(), color: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">自動化ルール一覧</h3>
        <button type="button" onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20">
          <Plus className="h-3 w-3" />
          ルール追加
        </button>
      </div>

      {/* Rules List */}
      <div className="space-y-3">
        {rules.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">自動化ルールがまだありません</div>
        )}
        {rules.map((rule) => {
          const cat = categoryFromTrigger(rule.trigger)
          const catConf = categoryConfig[cat] || categoryConfig.analytics
          const CatIcon = catConf.icon
          const isEnabled = rule.status === "ACTIVE"
          return (
            <div
              key={rule.id}
              className={cn("rounded-xl border border-border bg-card p-5 transition-all", isEnabled ? "hover:border-primary/20" : "opacity-60")}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", catConf.color)}>
                      <CatIcon className="h-3.5 w-3.5" />
                    </div>
                    <h4 className="text-sm font-semibold text-foreground">{rule.name}</h4>
                    <span className={cn("rounded-full px-2 py-0.5 text-[9px]", catConf.color)}>{catConf.label}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {rule.avatar?.name || "不明"}
                    </span>
                  </div>
                  {rule.description && <p className="mt-2 text-xs text-muted-foreground">{rule.description}</p>}
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="rounded-lg bg-secondary px-2.5 py-1 text-muted-foreground">{rule.trigger}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="rounded-lg bg-secondary px-2.5 py-1 text-muted-foreground">{rule.action}</span>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">
                      {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleDateString("ja-JP") : "未実行"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">最終実行</p>
                  </div>
                  <Switch checked={isEnabled} onCheckedChange={() => handleToggle(rule.id, rule.status)} />
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setEditingRule(rule)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => handleDelete(rule.id)} disabled={deletingId === rule.id}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-50">
                      {deletingId === rule.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
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
