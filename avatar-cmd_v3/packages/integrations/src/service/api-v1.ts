// ================================================
// 外部 AI 用 API v1 — /api/v1/*（API キー認証。管理画面の Cookie セッションとは別）
// ================================================
// リクエスト処理（認証 → 権限 → レート制限 → 二重実行防止 → 処理 → 監査ログ）をここで行い、
// Next.js のルートは handleApiV1(req) に渡すだけにする（テストで標準の Request から呼べるように）。
// 仕様は docs/API_V1.md。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import {
  ApiV1Error,
  authenticateApiKey,
  avatarScope,
  beginIdempotent,
  canAccessAvatar,
  checkRateLimit,
  finishIdempotent,
  redact,
  requestHash,
  requireAvatar,
  requireScope,
  writeApiAudit,
  type ApiPrincipal,
  type ApiScope,
} from "./api-keys";
import { approveDraft, createRule, discardContent, updateRule, type RuleInput } from "./automation";
import { latestPerformance } from "./performance";
import { generatePostText } from "./ai";
import { returnToDraft } from "./publish";
import { assertBudget, summarizeUsage, usageMonthRange, withUsageContext } from "./usage";
import * as knowledge from "./knowledge";
import { listImprovementCycles } from "./improvement";
import { parseProvidedSummary } from "./learning-summary";
import { submitTranscript, summarizeVideo } from "./youtube-learning";
import { submitArticleContent, summarizeArticle } from "./rss-learning";

interface Ctx {
  p: ApiPrincipal;
  params: string[];
  query: URLSearchParams;
  body: any;
  /** 監査ログに残す対象アバター */
  avatarId?: string | null;
}

type Handler = (c: Ctx) => Promise<{ status?: number; body: unknown }>;

interface RouteDef {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** 例: "drafts/:id/approve" */
  path: string;
  scope: ApiScope;
  handler: Handler;
}

const limitOf = (q: URLSearchParams, def = 50) => Math.min(Math.max(Number(q.get("limit")) || def, 1), 200);

/** クエリの avatarId（指定があれば権限を確認）と、キーの範囲を合わせた where 条件 */
function avatarFilter(c: Ctx) {
  const id = c.query.get("avatarId");
  if (id) {
    requireAvatar(c.p, id);
    c.avatarId = id;
    return { avatarId: id };
  }
  return avatarScope(c.p);
}

function contentView(r: any) {
  const meta = (r.metadata ?? {}) as Record<string, any>;
  const e = (r.engagement ?? {}) as Record<string, any>;
  return {
    id: r.id,
    avatarId: r.avatarId,
    platform: r.platform,
    accountId: r.snsAccountId,
    category: r.category,
    status: r.status,
    text: r.content,
    title: meta.title ?? null,
    automationId: meta.automationId ?? null,
    heldReason: meta.heldReason ?? null,
    review: meta.review ? { verdict: meta.review.verdict, summary: meta.review.summary ?? "" } : null,
    quote: meta.quote ? { url: meta.quote.url ?? null, method: meta.quote.method ?? null } : null,
    scheduledAt: r.scheduledPost?.scheduledAt ?? null,
    queueStatus: r.scheduledPost?.status ?? null,
    publishedAt: r.publishedAt,
    postUrl: r.postUrl,
    metrics: e.fetchedAt ? { views: e.views ?? null, engagements: e.engagements ?? null, engagementRate: e.engagementRate ?? null, fetchedAt: e.fetchedAt } : null,
    createdAt: r.createdAt,
  };
}

async function ownedContent(c: Ctx, id: string) {
  const r = await prisma.content.findUnique({ where: { id }, include: { scheduledPost: true } });
  if (!r) throw new ApiV1Error(404, "not_found", "対象が見つかりません");
  requireAvatar(c.p, r.avatarId);
  c.avatarId = r.avatarId;
  return r;
}

async function ownedRule(c: Ctx, id: string) {
  const r = await prisma.automationRule.findUnique({ where: { id } });
  if (!r) throw new ApiV1Error(404, "not_found", "対象が見つかりません");
  requireAvatar(c.p, r.avatarId);
  c.avatarId = r.avatarId;
  return r;
}

function ruleView(r: any, perf?: unknown) {
  return {
    id: r.id,
    avatarId: r.avatarId,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    actionType: r.actionType,
    trigger: r.triggerConfig,
    action: r.actionConfig,
    executionCount: r.executionCount,
    lastExecutedAt: r.lastExecutedAt,
    nextRunAt: r.nextRunAt,
    lastError: r.lastError,
    ...(perf !== undefined ? { performance: perf } : {}),
  };
}

const ROUTES: RouteDef[] = [
  {
    method: "GET",
    path: "me",
    scope: "read",
    handler: async ({ p }) => ({ body: { name: p.name, scopes: p.scopes, allAvatars: p.allAvatars, avatarIds: p.allAvatars ? null : p.avatarIds } }),
  },
  // --- アバター ---
  {
    method: "GET",
    path: "avatars",
    scope: "read",
    handler: async (c) => {
      const rows = await prisma.avatar.findMany({ where: c.p.allAvatars ? {} : { id: { in: c.p.avatarIds } }, orderBy: { createdAt: "asc" } });
      return { body: { avatars: rows.map(avatarView) } };
    },
  },
  {
    method: "GET",
    path: "avatars/:id",
    scope: "read",
    handler: async (c) => {
      requireAvatar(c.p, c.params[0]);
      c.avatarId = c.params[0];
      const a = await prisma.avatar.findUnique({ where: { id: c.params[0] }, include: { snsAccounts: { select: { id: true, platform: true, accountName: true, isActive: true } } } });
      if (!a) throw new ApiV1Error(404, "not_found", "対象が見つかりません");
      return { body: { avatar: { ...avatarView(a), accounts: a.snsAccounts } } };
    },
  },
  // --- ナレッジ ---
  {
    method: "GET",
    path: "knowledge",
    scope: "read",
    handler: async (c) => {
      const where = avatarFilter(c);
      const rows = await knowledge.listKnowledge({ ...where, kind: c.query.get("kind") ?? undefined, status: c.query.get("status") ?? undefined, take: limitOf(c.query) });
      return { body: { items: rows } };
    },
  },
  {
    method: "GET",
    path: "knowledge/search",
    scope: "read",
    handler: async (c) => {
      const avatarId = c.query.get("avatarId");
      requireAvatar(c.p, avatarId);
      c.avatarId = avatarId;
      const items = await knowledge.searchKnowledge({ avatarId: avatarId!, query: c.query.get("q") ?? "", platform: c.query.get("platform") ?? undefined, limit: limitOf(c.query, 8) });
      return { body: { items: items.map((i) => ({ ...i.item, score: i.score })) } };
    },
  },
  {
    method: "GET",
    path: "knowledge/:id",
    scope: "read",
    handler: async (c) => {
      const k = await knowledge.getKnowledge(c.params[0]);
      requireAvatar(c.p, k?.avatarId);
      c.avatarId = k!.avatarId;
      return { body: { item: k, revisions: await knowledge.listRevisions(k!.id) } };
    },
  },
  {
    method: "POST",
    path: "knowledge",
    scope: "knowledge:write",
    handler: async (c) => {
      requireAvatar(c.p, c.body?.avatarId);
      c.avatarId = c.body.avatarId;
      const item = await knowledge.createKnowledge(c.body, `api:${c.p.id}`);
      return { status: 201, body: { item } };
    },
  },
  {
    method: "PATCH",
    path: "knowledge/:id",
    scope: "knowledge:write",
    handler: async (c) => {
      const k = await knowledge.getKnowledge(c.params[0]);
      requireAvatar(c.p, k?.avatarId);
      c.avatarId = k!.avatarId;
      return { body: { item: await knowledge.updateKnowledge(k!.id, c.body ?? {}, `api:${c.p.id}`) } };
    },
  },
  {
    method: "POST",
    path: "knowledge/:id/revert",
    scope: "knowledge:write",
    handler: async (c) => {
      const k = await knowledge.getKnowledge(c.params[0]);
      requireAvatar(c.p, k?.avatarId);
      c.avatarId = k!.avatarId;
      return { body: { item: await knowledge.revertKnowledge(k!.id, Number(c.body?.version), `api:${c.p.id}`) } };
    },
  },
  // --- 学習ソース（YouTube 動画・RSS 記事）: 本文と要約を AI 側から登録する ---
  {
    method: "GET",
    path: "learning/videos",
    scope: "read",
    handler: async (c) => {
      const rows = await prisma.youtubeVideo.findMany({
        where: { ...(c.query.get("status") ? { transcriptStatus: c.query.get("status")! } : {}), ...(c.query.get("channelId") ? { channel: { channelId: c.query.get("channelId")! } } : {}) },
        orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 500,
        include: { channel: true },
      });
      const items = rows.filter((v) => learningAccessible(c, v.channel.avatarIds)).slice(0, limitOf(c.query)).map((v) => videoView(v));
      return { body: { videos: items } };
    },
  },
  {
    method: "GET",
    path: "learning/videos/:id",
    scope: "read",
    handler: async (c) => ({ body: { video: videoView(await ownedVideo(c, c.params[0]), true) } }),
  },
  {
    method: "POST",
    path: "learning/videos/:id/summarize",
    scope: "knowledge:write",
    handler: async (c) => {
      const v = await ownedVideo(c, c.params[0]);
      const b = c.body ?? {};
      const provided = parseProvidedSummary(b.summary, `api:${c.p.id}`);
      if (b.transcript !== undefined) await submitTranscript(v.id, String(b.transcript), `api:${c.p.id}`);
      if (b.summarize !== false) await summarizeVideo(v.id, provided);
      return { body: { video: videoView(await ownedVideo(c, v.id)) } };
    },
  },
  {
    method: "GET",
    path: "learning/articles",
    scope: "read",
    handler: async (c) => {
      const rows = await prisma.rssArticle.findMany({
        where: { ...(c.query.get("status") ? { status: c.query.get("status")! } : {}), ...(c.query.get("feedId") ? { feedRowId: c.query.get("feedId")! } : {}) },
        orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 500,
        include: { feed: true },
      });
      const items = rows.filter((a) => learningAccessible(c, a.feed.avatarIds)).slice(0, limitOf(c.query)).map((a) => articleView(a));
      return { body: { articles: items } };
    },
  },
  {
    method: "GET",
    path: "learning/articles/:id",
    scope: "read",
    handler: async (c) => ({ body: { article: articleView(await ownedArticle(c, c.params[0]), true) } }),
  },
  {
    method: "POST",
    path: "learning/articles/:id/summarize",
    scope: "knowledge:write",
    handler: async (c) => {
      const a = await ownedArticle(c, c.params[0]);
      const b = c.body ?? {};
      const provided = parseProvidedSummary(b.summary, `api:${c.p.id}`);
      if (b.content !== undefined) await submitArticleContent(a.id, String(b.content), `api:${c.p.id}`);
      if (b.summarize !== false) await summarizeArticle(a.id, provided);
      return { body: { article: articleView(await ownedArticle(c, a.id)) } };
    },
  },
  // --- 自動化ルール ---
  {
    method: "GET",
    path: "rules",
    scope: "read",
    handler: async (c) => {
      const rows = await prisma.automationRule.findMany({ where: avatarFilter(c), orderBy: { createdAt: "asc" } });
      const perf = await latestPerformance(rows.map((r) => r.id));
      return { body: { rules: rows.map((r) => ruleView(r, perf[r.id] ?? null)) } };
    },
  },
  {
    method: "GET",
    path: "rules/:id",
    scope: "read",
    handler: async (c) => ({ body: { rule: ruleView(await ownedRule(c, c.params[0])) } }),
  },
  {
    method: "POST",
    path: "rules",
    scope: "rules:write",
    handler: async (c) => {
      requireAvatar(c.p, c.body?.avatarId);
      c.avatarId = c.body.avatarId;
      const r = await createRule(c.body as RuleInput);
      return { status: 201, body: { rule: ruleView(r) } };
    },
  },
  {
    method: "PATCH",
    path: "rules/:id",
    scope: "rules:write",
    handler: async (c) => {
      await ownedRule(c, c.params[0]);
      const { avatarId: _ignored, ...input } = (c.body ?? {}) as RuleInput;
      const { rule, held } = await updateRule(c.params[0], input);
      return { body: { rule: ruleView(rule), heldQueuedPosts: held } };
    },
  },
  // --- 下書き ---
  {
    method: "GET",
    path: "drafts",
    scope: "read",
    handler: async (c) => {
      const rows = await prisma.content.findMany({ where: { ...avatarFilter(c), status: "DRAFT", snsAccountId: { not: null } }, orderBy: { createdAt: "desc" }, take: limitOf(c.query), include: { scheduledPost: true } });
      return { body: { drafts: rows.map(contentView) } };
    },
  },
  {
    method: "POST",
    path: "drafts",
    scope: "draft",
    handler: async (c) => {
      const b = c.body ?? {};
      const text = String(b.text ?? "").trim();
      if (!text) throw new ConfigError("text（本文）を入力してください");
      const accounts = await draftAccounts(c, b.accountIds);
      const created = [];
      for (const a of accounts) {
        created.push(
          await prisma.content.create({
            data: { avatarId: a.avatarId, platform: a.platform, snsAccountId: a.id, content: text, status: "DRAFT", category: "api", metadata: { title: b.title ?? undefined, media: [], options: {}, source: `api:${c.p.id}`, heldReason: "外部 API で作成（承認すると投稿）" } },
            include: { scheduledPost: true },
          })
        );
      }
      return { status: 201, body: { drafts: created.map(contentView) } };
    },
  },
  {
    method: "POST",
    path: "drafts/generate",
    scope: "draft",
    handler: async (c) => {
      const b = c.body ?? {};
      const topic = String(b.topic ?? "").trim();
      if (!topic) throw new ConfigError("topic を入力してください");
      const accounts = await draftAccounts(c, b.accountIds);
      await assertBudget("外部 API からの下書き生成");
      const created = [];
      const byPlatform = new Map<string, typeof accounts>();
      for (const a of accounts) byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);
      for (const [platform, accs] of byPlatform) {
        const gen = await withUsageContext({ avatarId: accs[0].avatarId }, () => generatePostText({ avatarId: accs[0].avatarId, topic, platform, extraPrompt: b.extraPrompt }));
        for (const a of accs) {
          created.push(
            await prisma.content.create({
              data: { avatarId: a.avatarId, platform, snsAccountId: a.id, content: gen.text, status: "DRAFT", category: "api", metadata: { title: topic, media: [], options: {}, model: gen.model, source: `api:${c.p.id}`, heldReason: "外部 API で AI 生成（承認すると投稿）" } },
              include: { scheduledPost: true },
            })
          );
        }
      }
      return { status: 201, body: { drafts: created.map(contentView) } };
    },
  },
  {
    method: "PATCH",
    path: "drafts/:id",
    scope: "draft",
    handler: async (c) => {
      const r = await ownedContent(c, c.params[0]);
      if (r.status !== "DRAFT") throw new ConfigError("下書きのみ編集できます");
      const text = String(c.body?.text ?? "").trim();
      if (!text) throw new ConfigError("text（本文）を入力してください");
      const u = await prisma.content.update({ where: { id: r.id }, data: { content: text }, include: { scheduledPost: true } });
      return { body: { draft: contentView(u) } };
    },
  },
  {
    method: "DELETE",
    path: "drafts/:id",
    scope: "draft",
    handler: async (c) => {
      const r = await ownedContent(c, c.params[0]);
      if (r.status !== "DRAFT") throw new ConfigError("下書きのみ削除できます");
      await discardContent(r.id);
      return { body: { ok: true } };
    },
  },
  {
    method: "POST",
    path: "drafts/:id/approve",
    scope: "publish",
    handler: async (c) => {
      const r = await ownedContent(c, c.params[0]);
      const at = c.body?.scheduledAt ? new Date(c.body.scheduledAt) : undefined;
      if (at && Number.isNaN(at.getTime())) throw new ConfigError("scheduledAt が不正です（ISO 8601）");
      await approveDraft(r.id, c.body?.text, at);
      return { body: { post: contentView(await prisma.content.findUniqueOrThrow({ where: { id: r.id }, include: { scheduledPost: true } })) } };
    },
  },
  // --- 予約投稿 ---
  {
    method: "GET",
    path: "scheduled",
    scope: "read",
    handler: async (c) => {
      const rows = await prisma.content.findMany({ where: { ...avatarFilter(c), status: { in: ["SCHEDULED", "PUBLISHING", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: limitOf(c.query), include: { scheduledPost: true } });
      return { body: { posts: rows.map(contentView) } };
    },
  },
  {
    method: "POST",
    path: "scheduled/:id/cancel",
    scope: "publish",
    handler: async (c) => {
      const r = await ownedContent(c, c.params[0]);
      const ok = await returnToDraft(r.id, `外部 API で予約を取り消し${c.body?.reason ? `: ${String(c.body.reason).slice(0, 200)}` : ""}`);
      if (!ok) throw new ConfigError("送信中・送信済み、または予約中でない投稿は取り消せません");
      return { body: { post: contentView(await prisma.content.findUniqueOrThrow({ where: { id: r.id }, include: { scheduledPost: true } })) } };
    },
  },
  // --- 実行履歴・分析・コスト ---
  {
    method: "GET",
    path: "runs",
    scope: "read",
    handler: async (c) => {
      const where = avatarFilter(c);
      const take = limitOf(c.query);
      const [activity, decisions, cycles] = await Promise.all([
        prisma.activityLog.findMany({ where, orderBy: { createdAt: "desc" }, take, select: { id: true, avatarId: true, action: true, category: true, level: true, description: true, createdAt: true } }),
        prisma.decisionEvent.findMany({ where, orderBy: { createdAt: "desc" }, take, select: { id: true, avatarId: true, decisionType: true, subjectId: true, engine: true, mode: true, selectedAction: true, confidence: true, applied: true, humanAction: true, error: true, createdAt: true } }),
        listImprovementCycles(where, take),
      ]);
      return { body: { activity, decisions, improvementCycles: cycles } };
    },
  },
  {
    method: "GET",
    path: "analytics",
    scope: "read",
    handler: async (c) => {
      const days = Math.min(Math.max(Number(c.query.get("days")) || 30, 1), 90);
      const rows = await prisma.content.findMany({
        where: { ...avatarFilter(c), status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - days * 86400_000) } },
        orderBy: { publishedAt: "desc" },
        take: 500,
        include: { scheduledPost: true },
      });
      const posts = rows.map(contentView);
      const withRate = posts.filter((p) => typeof p.metrics?.engagementRate === "number");
      return {
        body: {
          days,
          posts,
          summary: {
            published: posts.length,
            withMetrics: posts.filter((p) => p.metrics).length,
            avgEngagementRate: withRate.length ? withRate.reduce((s, p) => s + (p.metrics!.engagementRate as number), 0) / withRate.length : null,
          },
        },
      };
    },
  },
  {
    method: "GET",
    path: "costs",
    scope: "read",
    handler: async (c) => {
      const { from, to } = usageMonthRange();
      const s = await summarizeUsage(from, to);
      const groups = s.groups.filter((g) => (c.p.allAvatars ? true : canAccessAvatar(c.p, g.avatarId)));
      return { body: { note: "概算です。請求確定額ではありません。単価未登録の使用量は unpricedRows に数えます", from, to, groups } };
    },
  },
];

/** 学習ソースの要約は紐付いたアバター全員のナレッジになるため、全員を操作できるキーに限る */
function learningAccessible(c: Ctx, avatarIds: string[]) {
  return avatarIds.length > 0 && avatarIds.every((id) => canAccessAvatar(c.p, id));
}

function requireLearning(c: Ctx, avatarIds: string[]) {
  if (!learningAccessible(c, avatarIds)) throw new ApiV1Error(404, "not_found", "対象が見つかりません（このキーで操作できるアバターではない可能性があります）");
  c.avatarId = avatarIds[0];
}

async function ownedVideo(c: Ctx, id: string) {
  const v = await prisma.youtubeVideo.findUnique({ where: { id }, include: { channel: true } });
  if (!v) throw new ApiV1Error(404, "not_found", "対象が見つかりません");
  requireLearning(c, v.channel.avatarIds);
  return v;
}

async function ownedArticle(c: Ctx, id: string) {
  const a = await prisma.rssArticle.findUnique({ where: { id }, include: { feed: true } });
  if (!a) throw new ApiV1Error(404, "not_found", "対象が見つかりません");
  requireLearning(c, a.feed.avatarIds);
  return a;
}

function videoView(v: any, withText = false) {
  return {
    id: v.id,
    videoId: v.videoId,
    url: v.url,
    title: v.title,
    publishedAt: v.publishedAt,
    channel: { id: v.channel.id, channelId: v.channel.channelId, title: v.channel.title, ownership: v.channel.ownership, avatarIds: v.channel.avatarIds },
    status: v.transcriptStatus,
    transcriptMethod: v.transcriptMethod,
    hasTranscript: !!v.transcript,
    ...(withText ? { transcript: v.transcript ?? null, description: v.description ?? null } : {}),
    summary: v.summary,
    points: (v.summaryEvidence as { points?: unknown })?.points ?? [],
    knowledgeIds: v.knowledgeIds,
    error: v.error,
  };
}

function articleView(a: any, withText = false) {
  return {
    id: a.id,
    url: a.url,
    title: a.title,
    publishedAt: a.publishedAt,
    feed: { id: a.feed.id, url: a.feed.url, title: a.feed.title, avatarIds: a.feed.avatarIds },
    status: a.status,
    contentMethod: a.contentMethod,
    hasContent: !!a.content,
    excerpt: a.excerpt,
    ...(withText ? { content: a.content ?? null } : {}),
    summary: a.summary,
    points: (a.summaryEvidence as { points?: unknown })?.points ?? [],
    knowledgeIds: a.knowledgeIds,
    error: a.error,
  };
}

function avatarView(a: any) {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    specialization: a.specialization,
    targetAudience: a.targetAudience,
    status: a.status,
    description: a.description,
    persona: a.communication,
  };
}

async function draftAccounts(c: Ctx, accountIds: unknown) {
  const ids = Array.isArray(accountIds) ? [...new Set(accountIds.map(String))] : [];
  if (!ids.length) throw new ConfigError("accountIds（投稿先アカウント）を指定してください");
  const accounts = await prisma.snsAccount.findMany({ where: { id: { in: ids }, isActive: true } });
  if (accounts.length !== ids.length) throw new ApiV1Error(404, "not_found", "投稿先アカウントが見つからないか停止中です");
  for (const a of accounts) requireAvatar(c.p, a.avatarId);
  c.avatarId = accounts[0].avatarId;
  return accounts;
}

function match(method: string, segments: string[]): { route: RouteDef; params: string[] } | { allowed: string[] } | null {
  const allowed: string[] = [];
  for (const r of ROUTES) {
    const parts = r.path.split("/");
    if (parts.length !== segments.length) continue;
    const params: string[] = [];
    if (!parts.every((p, i) => (p.startsWith(":") ? (params.push(decodeURIComponent(segments[i])), true) : p === segments[i]))) continue;
    if (r.method === method) return { route: r, params };
    allowed.push(r.method);
  }
  return allowed.length ? { allowed } : null;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

/** /api/v1/* のリクエストを処理する */
export async function handleApiV1(req: Request): Promise<Response> {
  const started = Date.now();
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const segments = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
  const write = method !== "GET" && method !== "HEAD";
  const idemKey = write ? req.headers.get("idempotency-key") : null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  let keyId: string | null = null;
  let recordId: string | null = null;
  const ctx: Ctx = { p: undefined as unknown as ApiPrincipal, params: [], query: url.searchParams, body: undefined };
  let status = 500;
  let errorMsg: string | null = null;
  try {
    const p = await authenticateApiKey(req.headers.get("authorization"));
    keyId = p.id;
    ctx.p = p;
    const m = match(method, segments);
    if (!m) throw new ApiV1Error(404, "not_found", "API が見つかりません");
    if ("allowed" in m) throw new ApiV1Error(405, "method_not_allowed", `このパスで使えるメソッド: ${m.allowed.join(", ")}`, { Allow: m.allowed.join(", ") });
    requireScope(p, m.route.scope);
    await checkRateLimit(p.id, write);
    ctx.params = m.params;
    if (write) {
      const raw = await req.text();
      const begin = await beginIdempotent(p.id, idemKey, requestHash(method, url.pathname, raw));
      if (begin.kind === "replay") {
        status = begin.status;
        return json(begin.status, begin.body, { "Idempotent-Replayed": "true" });
      }
      recordId = begin.recordId;
      try {
        ctx.body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new ApiV1Error(400, "invalid_json", "本文を JSON として読めません");
      }
    }
    const res = await withUsageContext({ context: "api" }, () => m.route.handler(ctx));
    status = res.status ?? 200;
    if (recordId) await finishIdempotent(recordId, status, res.body);
    return json(status, res.body);
  } catch (e) {
    let body: { error: { code: string; message: string } };
    let headers: Record<string, string> = {};
    if (e instanceof ApiV1Error) {
      status = e.status;
      headers = e.headers;
      body = { error: { code: e.code, message: e.message } };
    } else if (e instanceof ConfigError) {
      status = 400;
      body = { error: { code: "invalid_request", message: e.message } };
    } else if ((e as { code?: string }).code === "P2025") {
      status = 404;
      body = { error: { code: "not_found", message: "対象が見つかりません" } };
    } else {
      status = 500;
      console.error("[api-v1]", redact(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)));
      body = { error: { code: "internal_error", message: "サーバーでエラーが発生しました" } };
    }
    errorMsg = body.error.message;
    if (recordId) await finishIdempotent(recordId, status, body);
    return json(status, body, headers);
  } finally {
    await writeApiAudit({ keyId, method, path: url.pathname, avatarId: ctx.avatarId ?? null, status, idempotencyKey: idemKey, latencyMs: Date.now() - started, ip, error: status >= 400 ? errorMsg : null });
  }
}

/** 仕様書・テスト用: 定義済みのルート一覧 */
export function apiV1Routes() {
  return ROUTES.map((r) => ({ method: r.method, path: `/api/v1/${r.path.replace(/:(\w+)/g, "{$1}")}`, scope: r.scope }));
}
