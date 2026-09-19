import { Job } from "./orchestrator";
import { prisma } from "@avatar-cmd/db";
import { readAvatarFile } from "../persona/soul-engine";
import { generatePostContent } from "../ai/router";
import { safeFetch, SsrfBlockedError } from "../security/url-guard";
import { enqueueBrowserJob } from "@avatar-cmd/queue";
import {
  createDefaultRegistry,
  type Platform,
  type PostContent,
  type ProviderCredentials,
} from "@avatar-cmd/integrations";
import { CredentialVault } from "../security/credential-vault";
// import cheerio for future HTML parsing, but for now fallback to fetch text

export async function processJob(job: Job): Promise<void> {
  const { type, payload } = job;

  try {
    switch (type) {
      case "generate_post":
        await handleGeneratePost(payload);
        break;
      case "publish_post":
        await handlePublishPost(payload);
        break;
      case "fetch_knowledge":
        await handleFetchKnowledge(payload);
        break;
      case "system_maintenance":
      default:
        console.log(`[Worker] Job type ${type} is not yet implemented.`);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // ダミー遅延
        break;
    }
  } catch (error) {
    console.error(`[Worker] Error processing job ${job.id}:`, error);
    throw error;
  }
}

async function handleGeneratePost(payload: any) {
  const { avatarId, automationId } = payload;
  if (!avatarId) throw new Error("Missing avatarId in payload");

  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
  if (!avatar) throw new Error("Avatar not found");

  await prisma.activityLog.create({
    data: {
      avatarId,
      action: "automation_started",
      category: "system",
      description: `Sagaプロセスを開始します`,
    },
  });

  const soulContent = await readAvatarFile(avatarId, "soul.md") || `Role: ${avatar.role}\nTone: ${avatar.role}`;
  
  // ナレッジの情報を取得してコンテキストに含める (最大最新5件)
  const recentKnowledge = await prisma.knowledgeItem.findMany({
    where: { avatarId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  let contextExt = "";
  if (recentKnowledge.length > 0) {
    contextExt = "\n\n【最近学習した知識（参考）】\n" + recentKnowledge.map(k => `・${k.title}: ${k.content ? k.content.slice(0, 100) : k.sourceUrl}`).join("\n");
  }

  const fullPromptLength = (soulContent + contextExt).length;

  const generatedText = await generatePostContent({
    soulContext: soulContent + contextExt,
    topic: payload.data?.topic || "日々の気づき",
  });

  // Prisma Schema V3 is Content, V2 was Post.
  const post = await prisma.content.create({
    data: {
      avatarId,
      platform: "X",
      content: generatedText,
      status: "DRAFT",
    },
  });

  await prisma.activityLog.create({
    data: {
      avatarId,
      action: "automation_completed",
      category: "content",
      description: `新しい下書きを作成しました: ${generatedText.slice(0, 40)}...`,
      metadata: {
        model: "gemini-2.5-flash",
        promptChars: fullPromptLength,
        outputChars: generatedText.length,
        topic: payload.data?.topic || "日々の気づき",
        knowledgeItems: recentKnowledge.length,
        postId: post.id,
        automationId: payload.automationId || null,
      },
    },
  });
  
  console.log(`[Worker] Successfully generated and saved content ${post.id}`);
}

// Provider のレジストリは毎回組み立てる必要がないので1回だけ
const registry = createDefaultRegistry();

/** 暗号化された認証情報を復号する。復号できない値は捨てる */
function decryptOrNull(vault: CredentialVault, value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return vault.decrypt(value);
  } catch {
    // 平文で入っている（暗号化前のデータ）可能性もあるが、
    // 判別できないものを認証情報として使うのは危険なので捨てる
    console.warn("[Worker] Failed to decrypt a credential; ignoring it");
    return undefined;
  }
}

async function handlePublishPost(payload: any) {
  // 対象の指定場所は投入元によって異なる:
  //   - スケジューラ (tick.ts) は data.contentId
  //   - API から直接投げる場合は payload 直下
  //   - v2 互換の呼び名は postId
  const contentId: string | undefined =
    payload.contentId ??
    payload.postId ??
    payload.data?.contentId ??
    payload.data?.postId;
  if (!contentId) throw new Error("Missing contentId");

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { avatar: { select: { id: true, name: true } } },
  });
  if (!content) throw new Error(`Content not found: ${contentId}`);

  // 二重投稿を避ける
  if (content.status === "PUBLISHED") {
    console.log(`[Worker] Content ${contentId} is already published; skipping`);
    return;
  }

  const provider = registry.get(content.platform as Platform);
  if (!provider) {
    await failContent(content.id, content.avatarId, `未対応のプラットフォーム: ${content.platform}`);
    return;
  }

  const account = await prisma.snsAccount.findFirst({
    where: { avatarId: content.avatarId, platform: content.platform, isActive: true },
  });
  if (!account) {
    await failContent(
      content.id,
      content.avatarId,
      `${content.platform} の有効なSNSアカウントが登録されていません`
    );
    return;
  }

  await prisma.content.update({
    where: { id: content.id },
    data: { status: "PUBLISHING" },
  });

  const vault = new CredentialVault();
  const credentials: ProviderCredentials = {
    authType: account.authType as ProviderCredentials["authType"],
    // hybrid にしておくと BaseProvider が API → ブラウザの順に試す
    operationMode: "hybrid",
    accessToken: decryptOrNull(vault, account.accessToken),
    refreshToken: decryptOrNull(vault, account.refreshToken),
    avatarId: content.avatarId,
    chromeProfileId: content.avatarId,
  };

  const postContent: PostContent = {
    text: content.content,
    metadata: (content.metadata ?? {}) as Record<string, unknown>,
  };

  const result = await provider.post(postContent, credentials);

  if (result.success) {
    await prisma.content.update({
      where: { id: content.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        externalPostId: result.postId ?? null,
        postUrl: result.url ?? null,
      },
    });
    // 予約でない投稿には ScheduledPost が無い。update だと例外になり
    // Prisma がエラーログを吐くため updateMany を使う（0件でも成功）
    await prisma.scheduledPost.updateMany({
      where: { contentId: content.id },
      data: { status: "published", publishedAt: new Date() },
    });

    await prisma.activityLog.create({
      data: {
        avatarId: content.avatarId,
        action: "post_published",
        category: "sns",
        description: `${content.platform} に投稿しました (${result.mode}): ${result.url ?? result.postId ?? ""}`,
        metadata: { contentId: content.id, mode: result.mode, postId: result.postId ?? null },
        level: "success",
      },
    });
    console.log(`[Worker] Published ${content.id} to ${content.platform} via ${result.mode}`);
    return;
  }

  // ブラウザモードに回された場合、Provider は操作列を用意できる。
  // ブラウザキューへ渡して chrome-empire に実行させる。
  if (result.mode === "browser" && provider.getPostSteps) {
    const operations = provider.getPostSteps(postContent);
    const jobId = await enqueueBrowserJob({
      kind: "operations",
      avatarId: content.avatarId,
      platform: content.platform,
      contentId: content.id,
      operations,
    });

    await prisma.activityLog.create({
      data: {
        avatarId: content.avatarId,
        action: "post_browser_queued",
        category: "sns",
        description: `${content.platform} はブラウザ操作で投稿します（${operations.length}ステップ）`,
        metadata: { contentId: content.id, browserJobId: jobId },
        level: "info",
      },
    });
    console.log(`[Worker] Queued browser job ${jobId} for ${content.id} (${content.platform})`);
    // Content は PUBLISHING のまま。chrome-empire 側の完了で確定させる
    return;
  }

  await failContent(content.id, content.avatarId, result.error ?? "投稿に失敗しました");
}

/** 投稿失敗を Content と ActivityLog に記録する */
async function failContent(contentId: string, avatarId: string, message: string): Promise<void> {
  await prisma.content.update({
    where: { id: contentId },
    data: { status: "FAILED" },
  });
  // 予約でない投稿には ScheduledPost が無いので updateMany（0件でも成功）
  await prisma.scheduledPost.updateMany({
    where: { contentId },
    data: { status: "failed", lastError: message },
  });
  await prisma.activityLog.create({
    data: {
      avatarId,
      action: "post_failed",
      category: "sns",
      description: message,
      metadata: { contentId },
      level: "error",
    },
  });
  // BullMQ のリトライに乗せるため例外にする
  throw new Error(message);
}

async function handleFetchKnowledge(payload: any) {
  const { avatarId, data } = payload;
  const { knowledgeId, url } = data;

  if (!knowledgeId || !url) throw new Error("Missing knowledgeId or url");

  console.log(`[Worker] Fetching knowledge from ${url}...`);
  await prisma.activityLog.create({
    data: {
      avatarId,
      action: "knowledge_update",
      category: "system",
      description: `URLからテキストの抽出を開始します: ${url}`,
    },
  });

  try {
    // 内部ネットワーク・クラウドメタデータへの到達を遮断する
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const html = await res.text();
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    
    const cleanText = bodyContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 5000);

    await prisma.knowledgeItem.update({
      where: { id: knowledgeId },
      data: {
        content: `【自動抽出】\n${cleanText}`,
        updatedAt: new Date(),
      },
    });

    await prisma.activityLog.create({
      data: {
        avatarId,
        action: "success",
        category: "system",
        description: `${url} からコンテンツを抽出しナレッジベースに保存しました。`,
      },
    });

  } catch (error: any) {
    const blocked = error instanceof SsrfBlockedError;
    console.error(`[Worker] Failed to fetch knowledge: ${error.message}`);
    await prisma.activityLog.create({
      data: {
        avatarId,
        action: blocked ? "security_blocked" : "error",
        category: "security",
        description: blocked
          ? `${url} はSSRF防御により拒否されました: ${error.message}`
          : `${url} の取得に失敗しました: ${error.message}`,
        level: blocked ? "warning" : "error",
      },
    });
  }
}
