// Adapters: v3 Prisma models → v2-compatible API shapes consumed by the dashboard UI.
import type { ActivityLog, Avatar, AutomationRule, Content, KnowledgeItem, Revenue, ScheduledPost, SnsAccount } from "@avatar-cmd/db"

const ROLE_KEYS: [RegExp, string][] = [
  [/ADHD|内向/, "adhd_introvert"],
  [/バイブ|コーダー|coder/i, "vibe_coder"],
  [/ウェルネス|wellness/i, "wellness_coach"],
  [/トレンド|trend/i, "trend_hunter"],
  [/知識|キュレーター|curator/i, "knowledge_curator"],
]

export function roleKey(role: string): string | null {
  return ROLE_KEYS.find(([re]) => re.test(role))?.[1] ?? null
}

type AvatarWithRelations = Avatar & {
  snsAccounts?: SnsAccount[]
  _count?: { contents?: number; revenues?: number; knowledgeItems?: number; automationRules?: number }
}

export function serializeAvatar(a: AvatarWithRelations) {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    roleKey: roleKey(a.role),
    specialization: a.specialization ?? "",
    targetAudience: a.targetAudience ?? "",
    tone: a.tone,
    description: a.description,
    status: a.status,
    avatarImageUrl: a.avatarImageUrl,
    moodScore: a.moodScore,
    writingRules: a.writingRules,
    lastSyncAt: a.lastSyncAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    platforms: (a.snsAccounts ?? []).map((s) => ({
      id: s.id,
      platform: s.platform,
      handle: s.accountName.replace(/^@/, ""),
      followerCount: s.followerCount ?? 0,
      isActive: s.isActive,
      healthScore: s.healthScore,
      hasCredentials: !!(s.accessToken || s.sessionData),
    })),
    _count: a._count
      ? {
          posts: a._count.contents ?? 0,
          revenue: a._count.revenues ?? 0,
          knowledge: a._count.knowledgeItems ?? 0,
          automations: a._count.automationRules ?? 0,
        }
      : undefined,
  }
}

export const avatarInclude = {
  snsAccounts: { orderBy: { createdAt: "asc" as const } },
  _count: { select: { contents: true, revenues: true, knowledgeItems: true, automationRules: true } },
}

type ContentWithRelations = Content & { scheduledPost?: ScheduledPost | null; avatar?: Pick<Avatar, "id" | "name" | "avatarImageUrl"> | null }

export function serializePost(c: ContentWithRelations) {
  const meta = (c.metadata ?? {}) as Record<string, unknown>
  return {
    id: c.id,
    avatarId: c.avatarId,
    content: c.content,
    platform: c.platform,
    category: c.category,
    status: c.status,
    scheduledAt: c.scheduledPost?.scheduledAt ?? null,
    publishedAt: c.publishedAt,
    postUrl: c.postUrl,
    externalPostId: c.externalPostId,
    engagementData: c.engagement && Object.keys(c.engagement as object).length ? c.engagement : null,
    moodAtCreation: c.moodAtCreation,
    sparkType: c.sparkType,
    generatedBy: (meta.generatedBy as string) ?? null,
    lastError: (meta.lastError as string) ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    avatar: c.avatar ? { id: c.avatar.id, name: c.avatar.name, avatarImageUrl: c.avatar.avatarImageUrl } : undefined,
  }
}

export function serializeActivity(a: ActivityLog & { avatar?: Pick<Avatar, "id" | "name" | "avatarImageUrl"> | null }) {
  const meta = a.metadata as Record<string, unknown> | null
  return {
    id: a.id,
    type: a.action,
    title: a.description,
    description: null as string | null,
    category: a.category,
    level: a.level,
    metadata: meta && Object.keys(meta).length ? JSON.stringify(meta) : null,
    createdAt: a.createdAt,
    avatar: a.avatar ? { id: a.avatar.id, name: a.avatar.name, avatarImageUrl: a.avatar.avatarImageUrl } : null,
  }
}

export function describeTrigger(r: Pick<AutomationRule, "triggerType" | "triggerConfig">): string {
  const cfg = (r.triggerConfig ?? {}) as Record<string, unknown>
  if (r.triggerType !== "schedule") return `${r.triggerType}`
  if (cfg.cron) return `cron: ${cfg.cron}`
  if (cfg.intervalSeconds) return `毎${cfg.intervalSeconds}秒`
  if (cfg.intervalMinutes) {
    const m = Number(cfg.intervalMinutes)
    return m % 1440 === 0 ? `毎${m / 1440}日` : m % 60 === 0 ? `毎${m / 60}時間` : `毎${m}分`
  }
  if (cfg.legacy) return String(cfg.legacy)
  return "schedule"
}

export const ACTION_LABELS: Record<string, string> = {
  generate_post: "AI投稿生成",
  publish_due: "予約投稿を公開",
  publish_post: "投稿を公開",
  fetch_knowledge: "ナレッジ収集",
  system_maintenance: "メンテナンス",
}

export function serializeAutomation(r: AutomationRule & { avatar?: Pick<Avatar, "id" | "name"> | null }) {
  return {
    id: r.id,
    avatarId: r.avatarId,
    name: r.name,
    description: r.description,
    category: r.category,
    trigger: describeTrigger(r),
    action: ACTION_LABELS[r.actionType] ?? r.actionType,
    triggerType: r.triggerType,
    triggerConfig: r.triggerConfig,
    actionType: r.actionType,
    actionConfig: r.actionConfig,
    status: r.lastError ? "ERROR" : r.isActive ? "ACTIVE" : "PAUSED",
    isActive: r.isActive,
    lastRunAt: r.lastExecutedAt,
    executionCount: r.executionCount,
    lastError: r.lastError,
    createdAt: r.createdAt,
    avatar: r.avatar ? { id: r.avatar.id, name: r.avatar.name } : undefined,
  }
}

export function serializeKnowledge(k: KnowledgeItem & { avatar?: Pick<Avatar, "id" | "name" | "role"> | null }) {
  return {
    id: k.id,
    avatarId: k.avatarId,
    title: k.title,
    content: k.content || k.summary || (k.sourceUrl ? "（取得中…）" : ""),
    summary: k.summary,
    category: k.category,
    source: k.source,
    tags: Array.isArray(k.tags) ? (k.tags as string[]) : [],
    sourceUrl: k.sourceUrl,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
    avatar: k.avatar ? { id: k.avatar.id, name: k.avatar.name } : undefined,
  }
}

export function serializeRevenue(r: Revenue & { avatar?: Pick<Avatar, "id" | "name"> | null }) {
  return {
    id: r.id,
    avatarId: r.avatarId,
    type: r.source,
    source: r.source,
    amount: r.amount,
    currency: r.currency,
    description: r.description,
    platform: r.platform,
    earnedAt: r.earnedAt,
    avatar: r.avatar ? { id: r.avatar.id, name: r.avatar.name } : undefined,
  }
}
