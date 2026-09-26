// ==============================================
// Workers — job handlers executed by the Orchestrator
// ==============================================

import { prisma, type Prisma } from "@avatar-cmd/db";
import type { Job, JobPayload } from "./orchestrator";
import { orchestrator } from "./orchestrator";
import { buildSoulContext, appendMemory } from "../persona/soul-engine";
import { MoodEngine } from "../persona/mood-engine";
import { generatePost } from "../ai/router";
import { publishContent } from "../publishing/publisher";
import { safeFetch, extractText, SsrfError } from "../security/ssrf-guard";

const moodEngine = new MoodEngine();

export async function processJob(job: Job): Promise<void> {
  console.log(`[Worker] Processing ${job.type} (${job.id}) attempt ${job.attempts}`);
  switch (job.type) {
    case "generate_post":
      return handleGeneratePost(job.payload);
    case "publish_post":
      return handlePublishPost(job.payload);
    case "publish_due":
      return handlePublishDue();
    case "fetch_knowledge":
      return handleFetchKnowledge(job.payload);
    case "system_maintenance":
      return handleMaintenance();
    default:
      throw new Error(`Unknown job type: ${String(job.type)}`);
  }
}

// ─── generate_post ────────────────────────────────

async function handleGeneratePost(payload: JobPayload) {
  const { avatarId, automationId } = payload;
  if (!avatarId) throw new Error("Missing avatarId in payload");

  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
  if (!avatar) throw new Error(`Avatar not found: ${avatarId}`);

  const data = payload.data ?? {};
  const topic = String(data.topic || "日々の気づき");
  const platform = String(data.platform || "x").toLowerCase();
  const writingRules = (avatar.writingRules ?? {}) as Record<string, unknown>;
  const maxLength = Number(writingRules.maxLength) || 280;

  // Persona context: Soul files + recent knowledge
  const fallback = `名前: ${avatar.name}\n役割: ${avatar.role}\n専門: ${avatar.specialization ?? ""}\nトーン: ${avatar.tone ?? ""}`;
  const soulContext = await buildSoulContext(avatarId, fallback);
  const recentKnowledge = await prisma.knowledgeItem.findMany({
    where: { avatarId, isActive: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const knowledgeCtx = recentKnowledge.length
    ? "\n\n【最近学習した知識（参考）】\n" +
      recentKnowledge.map((k) => `・${k.title}: ${(k.summary || k.content || k.sourceUrl || "").slice(0, 120)}`).join("\n")
    : "";

  // Mood Engine: time-decayed mood + occasional "intuition spark"
  const mood = moodEngine.calculate(avatar.moodScore, avatar.moodUpdatedAt);
  const spark = moodEngine.checkSpark(Number(process.env.SPARK_THRESHOLD || 0.05));
  await prisma.avatar.update({ where: { id: avatarId }, data: { moodScore: mood.score, moodUpdatedAt: mood.lastUpdated } });

  const generated = await generatePost({
    soulContext: soulContext + knowledgeCtx,
    topic,
    platform,
    maxLength,
    directive: spark?.directive,
    temperature: 0.7 * mood.creativityModifier,
  });

  const content = await prisma.content.create({
    data: {
      avatarId,
      platform,
      content: generated.text,
      status: "DRAFT",
      category: String(data.category || "viral"),
      moodAtCreation: mood.score,
      intuitionTriggered: !!spark,
      sparkType: spark?.type ?? null,
      metadata: {
        generatedBy: generated.model,
        mock: generated.mock,
        topic,
        automationId: automationId ?? null,
        ...(generated.error ? { aiError: generated.error } : {}),
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      avatarId,
      action: "content_generated",
      category: "content",
      level: generated.mock ? "warning" : "success",
      description: `新しい下書きを作成しました${generated.mock ? "（モック）" : ""}: ${generated.text.slice(0, 40)}...`,
      metadata: {
        model: generated.model,
        promptChars: soulContext.length + knowledgeCtx.length,
        outputChars: generated.text.length,
        topic,
        knowledgeItems: recentKnowledge.length,
        contentId: content.id,
        automationId: automationId ?? null,
        mood: Math.round(mood.score * 100) / 100,
        spark: spark?.type ?? null,
      } satisfies Prisma.InputJsonValue,
    },
  });
  await appendMemory(avatarId, `generated content ${content.id} on "${topic}"`).catch(() => {});

  // Optional: publish immediately (automation actionConfig.autoPublish)
  if (data.autoPublish === true) {
    await orchestrator.addJob("publish_post", { avatarId, contentId: content.id });
  }
  console.log(`[Worker] Generated content ${content.id} (${generated.model})`);
}

// ─── publish_post / publish_due ───────────────────

async function handlePublishPost(payload: JobPayload) {
  const contentId = payload.contentId ?? (payload.data?.contentId as string | undefined) ?? (payload.data?.postId as string | undefined);
  if (!contentId) throw new Error("Missing contentId");
  const outcome = await publishContent(contentId);
  console.log(`[Worker] Publish ${contentId}: ${outcome.status} (${outcome.mode})`);
}

async function handlePublishDue() {
  const due = await prisma.scheduledPost.findMany({
    where: { status: "pending", scheduledAt: { lte: new Date() } },
    take: 20,
  });
  for (const sp of due) {
    // Atomic claim so parallel schedulers never double-publish
    const claimed = await prisma.scheduledPost.updateMany({ where: { id: sp.id, status: "pending" }, data: { status: "processing" } });
    if (claimed.count === 1) await publishContent(sp.contentId);
  }
}

// ─── fetch_knowledge (SSRF-safe) ──────────────────

async function handleFetchKnowledge(payload: JobPayload) {
  const { avatarId } = payload;
  const knowledgeId = payload.data?.knowledgeId as string | undefined;
  const url = payload.data?.url as string | undefined;
  if (!knowledgeId || !url) throw new Error("Missing knowledgeId or url");

  await prisma.activityLog.create({
    data: { avatarId, action: "knowledge_fetch_started", category: "system", description: `URLからテキストの抽出を開始します: ${url}` },
  });

  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
    if (res.status < 200 || res.status >= 300) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
    const { title, text } = extractText(res.body, 8000);
    const item = await prisma.knowledgeItem.findUnique({ where: { id: knowledgeId } });
    await prisma.knowledgeItem.update({
      where: { id: knowledgeId },
      data: {
        content: text,
        summary: text.slice(0, 200),
        freshness: new Date(),
        ...(item && (!item.title || item.title === url) && title ? { title: title.slice(0, 200) } : {}),
      },
    });
    await prisma.activityLog.create({
      data: { avatarId, action: "knowledge_update", category: "system", level: "success", description: `${url} からコンテンツを抽出しナレッジベースに保存しました（${text.length}文字）` },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await prisma.knowledgeItem.update({ where: { id: knowledgeId }, data: { summary: `取得失敗: ${msg}` } }).catch(() => {});
    await prisma.activityLog.create({
      data: {
        avatarId,
        action: error instanceof SsrfError ? "security_blocked" : "error",
        category: error instanceof SsrfError ? "security" : "system",
        level: "error",
        description: `${url} の取得に失敗しました: ${msg}`,
      },
    });
    // SSRF blocks and client errors (4xx) are final — only retry network/5xx failures
    const status = (error as { httpStatus?: number }).httpStatus;
    const final = error instanceof SsrfError || (status !== undefined && status >= 400 && status < 500);
    if (!final) throw error;
  }
}

// ─── system_maintenance ───────────────────────────

async function handleMaintenance() {
  const retentionDays = Number(process.env.ACTIVITY_RETENTION_DAYS || 90);
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);
  const { count } = await prisma.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  console.log(`[Worker] Maintenance: removed ${count} old activity logs`);
}
