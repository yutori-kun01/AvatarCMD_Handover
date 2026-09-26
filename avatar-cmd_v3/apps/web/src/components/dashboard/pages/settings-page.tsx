"use client"

import { useState, useEffect } from "react"
import {
  User,
  Bell,
  Shield,
  Key,
  Globe,
  Palette,
  Database,
  Cpu,
  CreditCard,
  Mail,
  Smartphone,
  Save,
  Loader2,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApiData } from "@/hooks/use-api"

const SETTINGS_KEY = "avatar-cmd-settings"

interface AppSettings {
  profile: { name: string; email: string; timezone: string }
  display: { darkMode: boolean; animations: boolean; compactMode: boolean }
  notifications: Record<string, boolean>
  security: Record<string, boolean>
}

const defaultSettings: AppSettings = {
  profile: { name: "管理者", email: "admin@example.com", timezone: "Asia/Tokyo" },
  display: { darkMode: true, animations: true, compactMode: false },
  notifications: {
    post_delivery: false,
    revenue_alert: true,
    error_alert: true,
    weekly_report: true,
    mobile_push: false,
    collab_notify: true,
  },
  security: {
    two_factor: true,
    session_mgmt: true,
    ip_restrict: false,
    post_preview: false,
    audit_log: true,
  },
}

function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const updateProfile = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, profile: { ...prev.profile, [key]: value } }))
  }

  const toggleDisplay = (key: keyof AppSettings["display"]) => {
    setSettings((prev) => ({ ...prev, display: { ...prev.display, [key]: !prev.display[key] } }))
  }

  const toggleNotification = (key: string) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: !prev.notifications[key] },
    }))
  }

  const toggleSecurity = (key: string) => {
    setSettings((prev) => ({
      ...prev,
      security: { ...prev.security, [key]: !prev.security[key] },
    }))
  }
  return (
    <div className="space-y-6">
      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-5 bg-secondary">
          <TabsTrigger value="general">一般</TabsTrigger>
          <TabsTrigger value="notifications">通知</TabsTrigger>
          <TabsTrigger value="api">システム</TabsTrigger>
          <TabsTrigger value="security">セキュリティ</TabsTrigger>
          <TabsTrigger value="billing">プラン</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <User className="h-4 w-4" />
              プロフィール
            </h3>
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-muted-foreground">表示名</label>
                  <input
                    type="text"
                    value={settings.profile.name}
                    onChange={(e) => updateProfile("name", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">メールアドレス</label>
                  <input
                    type="email"
                    value={settings.profile.email}
                    onChange={(e) => updateProfile("email", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">タイムゾーン</label>
                <select className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none">
                  <option>Asia/Tokyo (JST +09:00)</option>
                  <option>America/New_York (EST -05:00)</option>
                  <option>Europe/London (GMT +00:00)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Palette className="h-4 w-4" />
              表示設定
            </h3>
            <div className="mt-5 space-y-4">
              {[
                { label: "ダークモード", description: "ダッシュボードのテーマをダークモードに設定", key: "darkMode" as const },
                { label: "アニメーション", description: "UIアニメーションを有効化", key: "animations" as const },
                { label: "コンパクトモード", description: "情報密度を上げてより多くのデータを表示", key: "compactMode" as const },
              ].map((setting) => (
                <div key={setting.label} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-foreground">{setting.label}</p>
                    <p className="text-xs text-muted-foreground">{setting.description}</p>
                  </div>
                  <Switch checked={settings.display[setting.key]} onCheckedChange={() => toggleDisplay(setting.key)} />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? "保存完了！" : "変更を保存"}
            </button>
          </div>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Bell className="h-4 w-4" />
              通知設定
            </h3>
            <div className="mt-5 space-y-5">
              {[
                { label: "投稿配信完了", description: "アバターが投稿を配信した時に通知", icon: Mail, key: "post_delivery" },
                { label: "収益発生", description: "新しい収益が発生した時に通知", icon: CreditCard, key: "revenue_alert" },
                { label: "エラーアラート", description: "システムエラーやAPIエラー発生時に通知", icon: Shield, key: "error_alert" },
                { label: "週次レポート", description: "毎週のパフォーマンスサマリーをメール送信", icon: Mail, key: "weekly_report" },
                { label: "モバイルプッシュ", description: "重要な通知をモバイルに送信", icon: Smartphone, key: "mobile_push" },
                { label: "コラボ通知", description: "アバター間のコラボ完了時に通知", icon: Bell, key: "collab_notify" },
              ].map((n) => (
                <div key={n.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
                      <n.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-foreground">{n.label}</p>
                      <p className="text-xs text-muted-foreground">{n.description}</p>
                    </div>
                  </div>
                  <Switch checked={settings.notifications[n.key]} onCheckedChange={() => toggleNotification(n.key)} />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* API */}
        <TabsContent value="api" className="space-y-4">
          <SystemStatusPanel />
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Shield className="h-4 w-4" />
              セキュリティ設定
            </h3>
            <div className="mt-5 space-y-5">
              {[
                { label: "二段階認証", description: "ログイン時にTOTPを要求", key: "two_factor" },
                { label: "セッション管理", description: "30日で自動ログアウト", key: "session_mgmt" },
                { label: "IP制限", description: "特定のIPアドレスからのみアクセスを許可", key: "ip_restrict" },
                { label: "投稿プレビュー", description: "投稿前に管理者の確認を必須にする", key: "post_preview" },
                { label: "監査ログ", description: "すべてのアクションを記録", key: "audit_log" },
              ].map((setting) => (
                <div key={setting.label} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-foreground">{setting.label}</p>
                    <p className="text-xs text-muted-foreground">{setting.description}</p>
                  </div>
                  <Switch checked={settings.security[setting.key]} onCheckedChange={() => toggleSecurity(setting.key)} />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Billing */}
        <TabsContent value="billing" className="space-y-4">
          <div className="rounded-xl border border-primary/30 bg-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">現在のプラン</h3>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-2xl font-bold text-primary">Pro</span>
                  <span className="text-sm text-muted-foreground">¥9,800 / 月</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">アバター10体まで、全機能利用可能</p>
              </div>
              <button type="button" className="rounded-lg bg-primary/10 px-4 py-2 text-xs text-primary transition-colors hover:bg-primary/20">
                プラン変更
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { name: "Starter", price: "¥2,980", features: ["アバター3体", "基本SNS連携", "月1,000投稿", "メールサポート"], current: false },
              { name: "Pro", price: "¥9,800", features: ["アバター10体", "全SNS連携", "無制限投稿", "優先サポート", "コラボ機能", "高度な分析"], current: true },
              { name: "Enterprise", price: "お問い合わせ", features: ["無制限アバター", "カスタムAPI", "専用インフラ", "24/7サポート", "SLA保証", "オンボーディング"], current: false },
            ].map((plan) => (
              <div
                key={plan.name}
                className={cn(
                  "rounded-xl border bg-card p-5",
                  plan.current ? "border-primary/40" : "border-border"
                )}
              >
                <h4 className="text-sm font-semibold text-foreground">{plan.name}</h4>
                <p className="mt-1 text-xl font-bold text-foreground">{plan.price}</p>
                {plan.price !== "お問い合わせ" && <p className="text-[10px] text-muted-foreground">/ 月</p>}
                <ul className="mt-4 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1 w-1 rounded-full bg-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.current ? (
                  <div className="mt-4 rounded-lg bg-primary/10 py-2 text-center text-xs text-primary">現在のプラン</div>
                ) : (
                  <button type="button" className="mt-4 w-full rounded-lg bg-secondary py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
                    選択
                  </button>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface SystemInfo {
  db: string
  queue: { backend: string; pending: number; processing: number; completed: number; failed: number } | null
  ai: { configured: boolean; model: string }
  publishMode: string
  encryption: boolean
  chromeEmpire: { online: boolean; updatedAt: string | null }
  schedulerTickMs: number
  avatarDataDir: string
  auditEvents24h: number
  version: string
}

function SystemStatusPanel() {
  const { data, loading, refetch } = useApiData<SystemInfo>("/api/system")
  if (loading && !data) return <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></div>
  if (!data) return null
  const rows: { label: string; value: string; ok: boolean; hint?: string }[] = [
    { label: "データベース (PostgreSQL)", value: data.db === "ok" ? "接続済み" : "エラー", ok: data.db === "ok" },
    { label: "ジョブキュー", value: data.queue ? `${data.queue.backend === "redis" ? "Redis (BullMQ)" : "インメモリ"} — 待機 ${data.queue.pending} / 完了 ${data.queue.completed} / 失敗 ${data.queue.failed}` : "未起動", ok: !!data.queue, hint: "REDIS_URL を設定すると永続キューになります" },
    { label: "AI 生成 (Gemini)", value: data.ai.configured ? data.ai.model : "モック生成", ok: data.ai.configured, hint: "GEMINI_API_KEY を設定すると実際のLLMで生成します" },
    { label: "投稿モード", value: data.publishMode === "live" ? "本番 (live)" : "ドライラン", ok: true, hint: "PUBLISH_MODE=live で実SNSへ配信" },
    { label: "資格情報の暗号化", value: data.encryption ? "AES-256-GCM 有効" : "ENCRYPTION_KEY 未設定", ok: data.encryption },
    { label: "Chrome Empire ワーカー", value: data.chromeEmpire.online ? "オンライン" : "オフライン", ok: data.chromeEmpire.online, hint: "ブラウザ専用プラットフォームの配信に必要" },
    { label: "スケジューラ間隔", value: `${data.schedulerTickMs / 1000}秒`, ok: true },
    { label: "Soul Engine データ", value: data.avatarDataDir, ok: true },
    { label: "監査ログ (24h)", value: `${data.auditEvents24h} 件`, ok: true },
  ]
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Cpu className="h-4 w-4" />
          システム稼働状況 <span className="text-[10px] font-normal text-muted-foreground">v{data.version}</span>
        </h3>
        <button type="button" onClick={() => refetch()} className="rounded bg-secondary px-3 py-1 text-xs text-muted-foreground hover:text-foreground">更新</button>
      </div>
      <div className="mt-5 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 rounded-lg bg-secondary p-3">
            <div>
              <p className="text-sm text-foreground">{r.label}</p>
              {!r.ok && r.hint && <p className="text-[10px] text-muted-foreground">{r.hint}</p>}
            </div>
            <span className={cn("text-right font-mono text-xs", r.ok ? "text-accent" : "text-[#fbbf24]")}>{r.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[10px] text-muted-foreground">APIキー等の秘密情報は環境変数（.env）で管理し、画面には表示しません。SNSアカウントのトークンはアバター管理 &gt; 設定タブから登録できます（暗号化保存）。</p>
    </div>
  )
}
