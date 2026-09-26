"use client"

import { Chrome, Cpu, Loader2, MemoryStick, RefreshCw, Server } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApiData } from "@/hooks/use-api"

interface PoolResponse {
  redisConfigured: boolean
  workerOnline: boolean
  updatedAt: string | null
  queue: Record<string, number> | null
  totalInstances: number
  activeInstances: number
  idleInstances: number
  errorInstances: number
  totalMemoryMB: number
  maxInstances?: number
  instances: { id: string; avatarId: string; status: string; metrics: { memoryMB: number; activePages: number; tasksCompleted: number; tasksErrored: number; uptime: number } }[]
}

export function ChromePage() {
  const { data, loading, refetch } = useApiData<PoolResponse>("/api/chrome-pool")
  const { data: avatars } = useApiData<{ id: string; name: string }[]>("/api/avatars")
  if (loading && !data) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  if (!data) return null
  const name = (id: string) => avatars?.find((a) => a.id === id)?.name ?? id

  return (
    <div className="space-y-6">
      <div className={cn("flex items-center justify-between rounded-xl border p-4", data.workerOnline ? "border-accent/30 bg-accent/5" : "border-[#fbbf24]/30 bg-[#fbbf24]/5")}>
        <div className="flex items-center gap-3">
          <Server className={cn("h-5 w-5", data.workerOnline ? "text-accent" : "text-[#fbbf24]")} />
          <div>
            <p className="text-sm font-semibold">{data.workerOnline ? "Chrome Empire ワーカー稼働中" : "Chrome Empire ワーカー未接続"}</p>
            <p className="text-xs text-muted-foreground">
              {data.workerOnline
                ? `最終ハートビート: ${data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString("ja-JP") : "-"}`
                : data.redisConfigured
                  ? "ワーカーを起動してください: pnpm worker:chrome（Docker: chrome-empire サービス）"
                  : "REDIS_URL が未設定のため、ブラウザ専用プラットフォームへの配信は利用できません"}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => refetch()} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3 w-3" />更新
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { l: "インスタンス", v: `${data.totalInstances} / ${data.maxInstances ?? "-"}`, icon: Chrome },
          { l: "実行中", v: data.activeInstances, icon: Cpu },
          { l: "アイドル", v: data.idleInstances, icon: Cpu },
          { l: "エラー", v: data.errorInstances, icon: Cpu },
          { l: "メモリ", v: `${data.totalMemoryMB} MB`, icon: MemoryStick },
        ].map((x) => (
          <div key={x.l} className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><x.icon className="h-3.5 w-3.5" />{x.l}</p>
            <p className="mt-1 text-2xl font-bold">{x.v}</p>
          </div>
        ))}
      </div>

      {data.queue && (
        <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          ブラウザタスクキュー: 待機 {data.queue.waiting ?? 0} / 実行中 {data.queue.active ?? 0} / 完了 {data.queue.completed ?? 0} / 失敗 {data.queue.failed ?? 0}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3"><h3 className="text-sm font-semibold">インスタンス一覧</h3></div>
        <div className="divide-y divide-border">
          {data.instances.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">起動中のブラウザインスタンスはありません（タスク投入時に自動起動します）</p>}
          {data.instances.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-xs">
              <div>
                <p className="text-sm font-medium">{name(i.avatarId)}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{i.id.slice(0, 8)}</p>
              </div>
              <span className={cn("rounded px-2 py-0.5", i.status === "running" ? "bg-accent/20 text-accent" : i.status === "error" ? "bg-destructive/20 text-destructive" : "bg-secondary text-muted-foreground")}>{i.status}</span>
              <span className="text-muted-foreground">完了 {i.metrics.tasksCompleted} / 失敗 {i.metrics.tasksErrored}</span>
              <span className="text-muted-foreground">ページ {i.metrics.activePages}</span>
              <span className="text-muted-foreground">稼働 {Math.floor(i.metrics.uptime / 60)}分</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
