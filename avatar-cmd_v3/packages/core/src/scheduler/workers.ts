import { randomUUID } from "crypto";
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
      case "browser_result":
        await handleBrowserResult(payload);
        break;
      case "system_maintenance":
      default:
        console.log(`[Worker] Job type ${type} is not yet implemented.`);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // ダミー遅延
        break;
    }
  } catch (error) {
    if (payload.avatarId) {
      await prisma.activityLog
        .create({
          data: {
            avatarId: payload.avatarId,
            action: "job_failed",
            category: "system",
            level: "error",
            description: `処理に失敗しました: ${error instanceof Error ? error.message : "実行エラー"}`,
            metadata: { jobId: job.id, type },
          },
        })
        .catch(() => undefined);
    }
    console.error(`[Worker] Job ${job.id} failed`);
    throw error;
  }
}

async function handleGeneratePost(payload: any) {
  const { avatarId, automationId } = payload;
  if (!avatarId) throw new Error("Missing avatarId in payload");

  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
  if (!avatar || (payload.userId && avatar.userId !== payload.userId))
    throw new Error("Avatar not found");
  if (avatar.status !== "ACTIVE")
    throw new Error("停止中のアバターは実行できません");

  await prisma.activityLog.create({
    data: {
      avatarId,
      action: "automation_started",
      category: "system",
      description: `Sagaプロセスを開始します`,
    },
  });

  const soulContent = [
    `名前: ${avatar.name}\n役割: ${avatar.role}\n専門: ${avatar.specialization ?? ""}\n読者: ${avatar.targetAudience ?? ""}`,
    ...(await Promise.all(
      ["soul.md", "identity.md", "rules.md"].map((name) =>
        readAvatarFile(avatarId, name),
      ),
    )),
  ]
    .filter(Boolean)
    .join("\n\n");
  const platform = String(payload.data?.platform ?? "x").toLowerCase();
  if (!registry.has(platform as Platform)) throw new Error("未対応のSNSです");

  // ナレッジの情報を取得してコンテキストに含める (最大最新5件)
  const recentKnowledge = await prisma.knowledgeItem.findMany({
    where: { avatarId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  let contextExt = "";
  if (recentKnowledge.length > 0) {
    contextExt =
      "\n\n【最近学習した知識（参考）】\n" +
      recentKnowledge
        .map(
          (k) =>
            `・${k.title}: ${k.content ? k.content.slice(0, 100) : k.sourceUrl}`,
        )
        .join("\n");
  }

  const fullPromptLength = (soulContent + contextExt).length;

  const generatedText = await generatePostContent({
    soulContext: soulContent + contextExt,
    platform,
    topic: payload.data?.topic || "日々の気づき",
  });

  // Prisma Schema V3 is Content, V2 was Post.
  const post = await prisma.content.create({
    data: {
      avatarId,
      platform,
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
function decryptOrNull(
  vault: CredentialVault,
  value: string | null,
): string | undefined {
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

/** Claim before any external side effect. Unknown outcomes require human review. */
async function handlePublishPost(payload: any) {
  const contentId =
    payload.data?.contentId ?? payload.contentId ?? payload.postId;
  if (typeof contentId !== "string" || !payload.avatarId)
    throw new Error("投稿とアバターを指定してください");
  const content = await prisma.content.findFirst({
    where: {
      id: contentId,
      avatarId: payload.avatarId,
      ...(payload.userId ? { avatar: { userId: payload.userId } } : {}),
    },
    include: { avatar: { select: { status: true } } },
  });
  if (!content) throw new Error("投稿が見つかりません");
  if (content.avatar.status !== "ACTIVE") return;
  if (!["APPROVED", "SCHEDULED"].includes(content.status)) return;
  const platform = content.platform.toLowerCase() as Platform;
  const provider = registry.get(platform);
  if (!provider) throw new Error("未対応のSNSです");
  const accounts = await prisma.snsAccount.findMany({
    where: {
      avatarId: content.avatarId,
      platform: { equals: platform, mode: "insensitive" },
      isActive: true,
    },
  });
  if (accounts.length !== 1)
    throw new Error("投稿先の有効なアカウントを1件だけ設定してください");
  const account = accounts[0];
  const vault = new CredentialVault();
  let accessToken = decryptOrNull(vault, account.accessToken);
  const refreshToken = decryptOrNull(vault, account.refreshToken);
  const browser =
    account.authType === "session" || account.authType === "cookie";
  if (!browser && account.tokenExpiry && account.tokenExpiry <= new Date()) {
    if (!refreshToken || !provider.refreshToken)
      throw new Error("認証の期限切れです。接続情報を更新してください");
    const tokens = await provider.refreshToken(refreshToken);
    if (!tokens.accessToken) throw new Error("認証の更新に失敗しました");
    accessToken = tokens.accessToken;
    await prisma.snsAccount.update({
      where: { id: account.id },
      data: {
        accessToken: vault.encrypt(tokens.accessToken),
        ...(tokens.refreshToken
          ? { refreshToken: vault.encrypt(tokens.refreshToken) }
          : {}),
        tokenExpiry: tokens.expiresAt ?? null,
      },
    });
  }
  if (!browser && !accessToken)
    throw new Error("APIトークンを設定してください");
  const metadata = (
    content.metadata &&
    typeof content.metadata === "object" &&
    !Array.isArray(content.metadata)
      ? content.metadata
      : {}
  ) as Record<string, any>;
  const postContent: PostContent = { text: content.content, metadata };
  const operations = browser ? provider.getPostSteps?.(postContent) : undefined;
  // Without a post-specific success signal, clicking is not evidence of publication.
  if (
    browser &&
    (!operations?.length || !operations.some((op) => op.confirmationUrlPattern))
  ) {
    throw new Error(
      "このSNSのブラウザ投稿は公開確認手順の検証が必要です。現在は実行できません",
    );
  }
  const attemptId = randomUUID();
  const claimed = await prisma.content.updateMany({
    where: {
      id: content.id,
      status: { in: ["APPROVED", "SCHEDULED"] },
      updatedAt: content.updatedAt,
      avatar: { status: "ACTIVE" },
    },
    data: {
      status: "PUBLISHING",
      platform,
      metadata: { ...metadata, publishAttemptId: attemptId },
    },
  });
  if (!claimed.count) return;
  try {
    if (browser && operations) {
      await enqueueBrowserJob({
        kind: "operations",
        avatarId: content.avatarId,
        platform,
        contentId: content.id,
        attemptId,
        operations,
      });
      return;
    }
    // Do not retry through a browser after an ambiguous API response.
    const credentials: ProviderCredentials = {
      authType: account.authType as ProviderCredentials["authType"],
      operationMode: "api",
      accessToken,
      refreshToken,
      avatarId: content.avatarId,
    };
    const result = await provider.post(postContent, credentials);
    if (!result.success || (!result.postId && !result.url))
      throw new Error("公開結果を確認できませんでした");
    await settlePublication(
      content.id,
      content.avatarId,
      attemptId,
      true,
      result.url,
      result.postId,
    );
  } catch {
    await settlePublication(content.id, content.avatarId, attemptId, false);
    // REVIEW is deliberately not retryable: the external post may already exist.
  }
}

async function settlePublication(
  contentId: string,
  avatarId: string,
  attemptId: string,
  success: boolean,
  url?: string,
  postId?: string,
) {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.content.updateMany({
      where: {
        id: contentId,
        avatarId,
        status: "PUBLISHING",
        metadata: { path: ["publishAttemptId"], equals: attemptId },
      },
      data: success
        ? {
            status: "PUBLISHED",
            publishedAt: new Date(),
            postUrl: url ?? null,
            externalPostId: postId ?? null,
          }
        : { status: "REVIEW" },
    });
    if (!changed.count) return;
    await tx.scheduledPost.updateMany({
      where: { contentId },
      data: success
        ? { status: "published", publishedAt: new Date(), lastError: null }
        : {
            status: "review",
            lastError:
              "公開先を確認してから再承認してください（自動再送は停止しました）",
          },
    });
    await tx.activityLog.create({
      data: {
        avatarId,
        action: success ? "post_published" : "post_needs_review",
        category: "sns",
        description: success
          ? "公開を確認しました"
          : "公開結果が不明です。公開先を確認してから再承認してください。",
        level: success ? "success" : "warning",
        metadata: { contentId, attemptId },
      },
    });
  });
}

async function handleBrowserResult(payload: any) {
  const data = payload?.data ?? {};
  if (
    typeof data.contentId !== "string" ||
    typeof data.attemptId !== "string" ||
    !payload.avatarId
  )
    throw new Error("投稿結果の識別情報が不足しています");
  const confirmed =
    data.success === true &&
    typeof data.url === "string" &&
    /^https:\/\//.test(data.url);
  await settlePublication(
    data.contentId,
    payload.avatarId,
    data.attemptId,
    confirmed,
    confirmed ? data.url : undefined,
  );
}

async function handleFetchKnowledge(payload: any) {
  const { avatarId, data } = payload;
  const { knowledgeId, url } = data;
  const target = await prisma.knowledgeItem.findFirst({
    where: {
      id: knowledgeId,
      avatarId,
      ...(payload.userId ? { avatar: { userId: payload.userId } } : {}),
    },
  });
  if (!target || target.sourceUrl !== url)
    throw new Error("収集対象が一致しません");

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
    throw error;
  }
}
