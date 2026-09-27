// ================================================
// 投稿パイプライン — 予約キュー（ScheduledPost）を処理して各SNSへ投稿する
// ================================================
import { prisma } from "@avatar-cmd/db";
import type { PostInput } from "../types";
import { getPlatform } from "../platforms";
import { ApiError, ConfigError } from "../http";
import { loadFreshCredentials } from "./accounts";
import { getSystemConfig } from "./store";
import { toMediaFile, type MediaRef } from "./media";

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
    text: content.content,
    title: meta.title,
    link: meta.link,
    tags: meta.tags,
    media: (meta.media ?? []).map((m) => toMediaFile(m, system)),
    options: meta.options ?? {},
    quotePostId: meta.quote?.postId,
  };
  if (post.quotePostId && !def.supportsQuote) throw new ConfigError(`${def.name} は引用投稿に対応していません`);

  await prisma.content.update({ where: { id: contentId }, data: { status: "PUBLISHING" } });
  const result = await def.publish(
    { app, credentials, settings: (acc.settings ?? {}) as Record<string, unknown>, account: { accountId: acc.accountId ?? "", accountName: acc.accountName }, system },
    post
  );
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

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.platform} API ${e.status}: ${e.body.slice(0, 400)}`;
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
