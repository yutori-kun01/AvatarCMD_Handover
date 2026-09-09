import { Job } from "./orchestrator";
import { prisma } from "@/lib/prisma";
import { readAvatarFile } from "@/lib/avatar-fs/parser";
import { generatePostContent } from "@/lib/ai/router";
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

  await prisma.activity.create({
    data: {
      avatarId,
      type: "automation_started",
      title: "投稿生成ジョブ開始",
      description: `Sagaプロセスを開始します`,
    },
  });

  const soulContent = await readAvatarFile(avatarId, "soul.md") || `Role: ${avatar.role}\nTone: ${avatar.tone}`;
  
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

  const post = await prisma.post.create({
    data: {
      avatarId,
      platform: "X",
      content: generatedText,
      status: "DRAFT",
    },
  });

  await prisma.activity.create({
    data: {
      avatarId,
      type: "automation_completed",
      title: "投稿の自動生成完了",
      description: `新しい下書きを作成しました: ${generatedText.slice(0, 40)}...`,
      metadata: JSON.stringify({
        model: "gemini-2.5-flash",
        promptChars: fullPromptLength,
        outputChars: generatedText.length,
        topic: payload.data?.topic || "日々の気づき",
        knowledgeItems: recentKnowledge.length,
        postId: post.id,
        automationId: payload.automationId || null,
      }),
    },
  });
  
  console.log(`[Worker] Successfully generated and saved post ${post.id}`);
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
  await prisma.activity.create({
    data: {
      avatarId,
      type: "knowledge_update",
      title: "ナレッジ収集ジョブ開始",
      description: `URLからテキストの抽出を開始します: ${url}`,
    },
  });

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    
    // 簡易的なテキスト抽出 (HTMLタグを雑に削除)
    const html = await res.text();
    // <body> 内を適当に抜き出すだけの簡易版。実運用では Cheerio/Playwright 推奨
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    
    // script/styleを除去してタグを消す簡易スクレイピング
    const cleanText = bodyContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 5000); // 制限

    await prisma.knowledgeItem.update({
      where: { id: knowledgeId },
      data: {
        content: `【自動抽出】\n${cleanText}`,
        updatedAt: new Date(),
      },
    });

    await prisma.activity.create({
      data: {
        avatarId,
        type: "success",
        title: "ナレッジ収集完了",
        description: `${url} からコンテンツを抽出しナレッジベースに保存しました。`,
      },
    });

  } catch (error: any) {
    console.error(`[Worker] Failed to fetch knowledge: ${error.message}`);
    await prisma.activity.create({
      data: {
        avatarId,
        type: "error",
        title: "ナレッジ収集失敗",
        description: `${url} の取得に失敗しました: ${error.message}`,
      },
    });
  }
}
