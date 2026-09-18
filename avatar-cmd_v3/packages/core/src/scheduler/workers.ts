import { Job } from "./orchestrator";
import { prisma } from "@avatar-cmd/db";
import { readAvatarFile } from "../persona/soul-engine";
import { generatePostContent } from "../ai/router";
import { safeFetch, SsrfBlockedError } from "../security/url-guard";
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

async function handlePublishPost(payload: any) {
  const { postId } = payload;
  if (!postId) throw new Error("Missing postId");

  console.log(`[Worker] Publishing post ${postId}...`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
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
