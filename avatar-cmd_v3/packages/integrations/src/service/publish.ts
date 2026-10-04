// ================================================
// 投稿パイプライン — 予約キュー（ScheduledPost）を処理して各SNSへ投稿する
// ================================================
import { prisma } from "@avatar-cmd/db";
import type { PostInput } from "../types";
import { getPlatform } from "../platforms";
import { ApiError, ConfigError, describeBody } from "../http";
import { loadFreshCredentials } from "./accounts";
import { getSystemConfig } from "./store";
import { toMediaFile, type MediaRef } from "./media";
import { cleanPostText } from "../post-text";
import { taskForPlatform } from "./ai";
import { recordUsage } from "./usage";

export interface ContentMetadata {
  title?: string;
  link?: string;
  tags?: string[];
  media?: MediaRef[];
  options?: Record<string, string>;
  result?: { note?: string };
  /** 引用投稿の引用元 */
  quote?: { postId: string; url?: string; authorUsername?: string; text?: string; candidateId?: string };
}

export interface CreatePostInput {
  accountIds: string[];
  text: string;
  title?: string;
  link?: string;
  tags?: string[];
  media?: MediaRef[];
  options?: Record<string, Record<string, string>>; // platform → 投稿オプション
  scheduledAt?: Date;
  /** 分類（manual / automation / quote）。集計に使う */
  category?: string;
  /** metadata に追加で残す値（自動化ルールID・生成モデル・引用元など） */
  extraMetadata?: Partial<ContentMetadata> & Record<string, unknown>;
}

/** 投稿を作成して予約キューに入れる（アカウントごとに1件） */
export async function createPosts(input: CreatePostInput) {
  const accounts = await prisma.snsAccount.findMany({ where: { id: { in: input.accountIds }, isActive: true } });
  if (!accounts.length) throw new ConfigError("投稿先アカウントを選択してください");
  const created = [];
  for (const acc of accounts) {
    const def = getPlatform(acc.platform);
    if (!def?.publish) throw new ConfigError(`${def?.name ?? acc.platform} は自動投稿に対応していません`);
    validateMedia(def.name, def.media, input.media ?? []);
    const metadata: ContentMetadata = {
      ...(input.extraMetadata ?? {}),
      title: input.title,
      link: input.link,
      tags: input.tags,
      media: input.media ?? [],
      options: input.options?.[acc.platform] ?? {},
    };
    const content = await prisma.content.create({
      data: {
        avatarId: acc.avatarId,
        platform: acc.platform,
        snsAccountId: acc.id,
        content: input.text,
        status: "SCHEDULED",
        category: input.category ?? "manual",
        metadata: metadata as object,
        scheduledPost: { create: { scheduledAt: input.scheduledAt ?? new Date(), status: "pending" } },
      },
      include: { scheduledPost: true },
    });
    created.push(content);
  }
  return created;
}

function validateMedia(name: string, spec: { image: boolean; video: boolean; required?: string; maxCount?: number }, media: MediaRef[]) {
  const videos = media.filter((m) => m.mimeType.startsWith("video/"));
  const images = media.length - videos.length;
  if (images && !spec.image) throw new ConfigError(`${name}: 画像の添付には対応していません`);
  if (videos.length && !spec.video) throw new ConfigError(`${name}: 動画の添付には対応していません`);
  if (spec.required === "video" && !videos.length) throw new ConfigError(`${name}: 動画の添付が必要です`);
  if (spec.required === "any" && !media.length) throw new ConfigError(`${name}: 画像または動画の添付が必要です`);
  if (spec.maxCount !== undefined && media.length > spec.maxCount) throw new ConfigError(`${name}: 添付は${spec.maxCount}件までです`);
}

/** 1件投稿する。成功/失敗を Content と ActivityLog に記録する */
export async function publishContent(contentId: string) {
  const content = await prisma.content.findUniqueOrThrow({ where: { id: contentId }, include: { snsAccount: true } });
  const acc = content.snsAccount;
  if (!acc) throw new ConfigError("投稿先アカウントが削除されています");
  const def = getPlatform(acc.platform);
  if (!def?.publish) throw new ConfigError(`${acc.platform} は自動投稿に対応していません`);

  const system = await getSystemConfig();
  const { credentials, app } = await loadFreshCredentials(acc.id);
  const meta = (content.metadata ?? {}) as ContentMetadata;
  const post: PostInput = {
    // 「」の除去・箇条書きの改行（どのプラットフォームでも投稿前に必ず通す）
    text: cleanPostText(content.content, { article: taskForPlatform(acc.platform) === "article" }),
    title: meta.title,
    link: meta.link,
    tags: meta.tags,
    media: (meta.media ?? []).map((m) => toMediaFile(m, system)),
    options: meta.options ?? {},
    quotePostId: meta.quote?.postId,
    quotePostUrl: meta.quote?.url,
  };
  if (post.quotePostId && !def.supportsQuote) throw new ConfigError(`${def.name} は引用投稿に対応していません`);

  await prisma.content.update({ where: { id: contentId }, data: { status: "PUBLISHING" } });
  const result = await def.publish(
    { app, credentials, settings: (acc.settings ?? {}) as Record<string, unknown>, account: { accountId: acc.accountId ?? "", accountName: acc.accountName }, system },
    post
  );
  // 投稿 API の呼び出し回数（ツリー投稿は件数分）。単価は料金表で登録したときだけ費用になる
  await recordUsage({ provider: acc.platform, purpose: "post_publish", avatarId: content.avatarId, context: "publish", subjectId: contentId, requests: Math.max(1, Number(/ツリー投稿（(\d+)件）/.exec(result.note ?? "")?.[1]) || 1) });
  const now = new Date();
  await prisma.$transaction([
    prisma.content.update({
      where: { id: contentId },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        externalPostId: result.postId,
        postUrl: result.url ?? null,
        metadata: { ...meta, result: { note: result.note } } as object,
      },
    }),
    prisma.snsAccount.update({ where: { id: acc.id }, data: { lastError: null, lastSyncAt: now, healthScore: 100 } }),
    prisma.activityLog.create({
      data: {
        avatarId: content.avatarId,
        action: "post_published",
        category: "sns",
        level: "success",
        description: `${def.name} (${acc.accountName}) に投稿しました${result.note ? `（${result.note}）` : ""}`,
        metadata: { contentId, postId: result.postId, url: result.url ?? null },
      },
    }),
  ]);
  return result;
}

/**
 * 予約中の投稿を下書き（承認待ち）に戻す。予約キューの行は消し、理由を metadata.heldReason に残す。
 * 既に送信中・送信済みなら何もしない（false）。
 */
export async function returnToDraft(contentId: string, reason: string): Promise<boolean> {
  const c = await prisma.content.findUnique({ where: { id: contentId }, include: { scheduledPost: true } });
  if (!c || c.status !== "SCHEDULED" || (c.scheduledPost && c.scheduledPost.status !== "pending")) return false;
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  // 同時に worker が取り出していないことを条件付きで確認してから戻す
  const removed = await prisma.scheduledPost.deleteMany({ where: { contentId, status: "pending" } });
  if (c.scheduledPost && !removed.count) return false;
  await prisma.content.update({ where: { id: contentId }, data: { status: "DRAFT", metadata: { ...meta, heldReason: reason, heldAt: new Date().toISOString() } as object } });
  await prisma.activityLog.create({
    data: { avatarId: c.avatarId, action: "post_held", category: "sns", level: "warning", description: `予約を下書きに戻しました: ${reason}`, metadata: { contentId } },
  });
  return true;
}

/**
 * 投稿直前の再確認。送信してよければ null、止めるべきなら理由を返す。
 * - アカウントが停止・削除されている / アバターが ACTIVE でない
 * - 自動承認された投稿で、ルールが削除・停止された、下書きモードに変わった、承認範囲が厳しくなって条件を満たさない
 * 人が承認した投稿は、ルールの状態にかかわらず送信する（アカウント・アバターの確認のみ）。
 */
export async function prePublishCheck(contentId: string): Promise<string | null> {
  const c = await prisma.content.findUniqueOrThrow({ where: { id: contentId }, include: { snsAccount: true, avatar: { select: { status: true } } } });
  if (!c.snsAccount) return "投稿先アカウントが削除されています";
  if (!c.snsAccount.isActive) return "投稿先アカウントが停止中です";
  if (c.avatar.status !== "ACTIVE") return `アバターが稼働中ではありません（${c.avatar.status}）`;
  const meta = (c.metadata ?? {}) as Record<string, any>;
  if (!meta.automationId || !meta.autoApproved || meta.humanApprovedAt) return null;
  const rule = await prisma.automationRule.findUnique({ where: { id: String(meta.automationId) } });
  if (!rule) return "自動化ルールが削除されています";
  if (!rule.isActive) return `自動化「${rule.name}」が停止中です`;
  const action = (rule.actionConfig ?? {}) as { mode?: string; approval?: string };
  if (action.mode !== "auto") return `自動化「${rule.name}」が下書きモードに変更されています`;
  const order = ["all", "standard", "strict"];
  const now = order.indexOf(action.approval ?? "all");
  if (now > order.indexOf(String(meta.autoApproved))) {
    // 承認範囲が厳しくなった: 作成時の判定結果で、今の条件を満たすかを確かめる
    const { autoApprovalDecision } = await import("./automation");
    const d = autoApprovalDecision(action.approval as "standard" | "strict", meta.review ?? { verdict: "error", error: "判定結果なし" }, meta.jev ? { ...meta.jev, publish: !!meta.jev.publish, reason: meta.jev.reason ?? "" } : undefined);
    if (!d.publish) return `自動化「${rule.name}」の承認範囲が変更され、条件を満たしません（${d.reason ?? ""}）`;
  }
  return null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.platform} API ${e.status}: ${describeBody(e.body).slice(0, 400)}`;
  return e instanceof Error ? e.message : String(e);
}

/** 再試行しても直らない失敗か（設定不備・認証エラー・リクエスト不正） */
function isPermanent(e: unknown): boolean {
  if (e instanceof ConfigError) return true;
  if (e instanceof ApiError) return e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
  return false;
}

/**
 * 期限の来た予約投稿を処理する（worker から定期実行）。
 * 同時実行されても二重投稿しないよう、status を条件付き更新で確保してから処理する。
 */
export async function processDuePosts({ limit = 10, maxRetries = 3 } = {}): Promise<number> {
  const now = new Date();
  // 処理中のまま止まったもの（worker 再起動など）は失敗扱いにする。二重投稿を避けるため自動再送はしない
  await prisma.scheduledPost.updateMany({
    where: { status: "processing", updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
    data: { status: "failed", lastError: "処理中に中断されました（投稿済みか各SNSで確認してください）" },
  });

  const due = await prisma.scheduledPost.findMany({
    where: { status: "pending", scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  });

  let processed = 0;
  for (const job of due) {
    const claimed = await prisma.scheduledPost.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    processed++;
    const stop = await prePublishCheck(job.contentId).catch((e) => `再確認に失敗: ${errorMessage(e)}`);
    if (stop) {
      await prisma.scheduledPost.update({ where: { id: job.id }, data: { status: "pending" } });
      await returnToDraft(job.contentId, `投稿直前の確認で保留: ${stop}`);
      continue;
    }
    try {
      await publishContent(job.contentId);
      await prisma.scheduledPost.update({ where: { id: job.id }, data: { status: "published", publishedAt: new Date(), lastError: null } });
    } catch (e) {
      const attempts = job.attempts + 1;
      const permanent = isPermanent(e) || attempts >= maxRetries;
      const msg = errorMessage(e);
      await prisma.scheduledPost.update({
        where: { id: job.id },
        data: permanent
          ? { status: "failed", lastError: msg }
          : { status: "pending", lastError: msg, nextAttemptAt: new Date(Date.now() + 4 ** attempts * 60_000) },
      });
      const content = await prisma.content.update({
        where: { id: job.contentId },
        data: { status: permanent ? "FAILED" : "SCHEDULED" },
        include: { snsAccount: true },
      });
      if (content.snsAccount) {
        await prisma.snsAccount.update({ where: { id: content.snsAccount.id }, data: { lastError: msg } });
      }
      await prisma.activityLog.create({
        data: {
          avatarId: content.avatarId,
          action: "post_failed",
          category: "sns",
          level: permanent ? "error" : "warning",
          description: `${getPlatform(content.platform)?.name ?? content.platform} への投稿に失敗: ${msg.slice(0, 300)}${permanent ? "" : "（再試行します）"}`,
          metadata: { contentId: content.id, attempts },
        },
      });
    }
  }
  return processed;
}

/** 失敗した投稿を再キューに入れる */
export async function retryPost(contentId: string) {
  await prisma.scheduledPost.update({
    where: { contentId },
    data: { status: "pending", scheduledAt: new Date(), nextAttemptAt: null, attempts: 0, lastError: null },
  });
  await prisma.content.update({ where: { id: contentId }, data: { status: "SCHEDULED" } });
}
