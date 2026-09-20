import { prisma } from "@avatar-cmd/db";
import type { AppJobPayload, AppJobType } from "@avatar-cmd/queue";

export class JobAccessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Resolve the actual target before enqueueing; never trust a caller's avatarId. */
export async function authorizeJob(
  userId: string,
  type: AppJobType,
  raw: AppJobPayload,
): Promise<AppJobPayload> {
  const data =
    raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
      ? raw.data
      : {};
  let avatarId = raw.avatarId;
  let clean: Record<string, unknown> = {};
  if (type === "publish_post") {
    const legacy = raw as AppJobPayload & {
      contentId?: string;
      postId?: string;
    };
    const id =
      data.contentId ?? data.postId ?? legacy.contentId ?? legacy.postId;
    if (typeof id !== "string")
      throw new JobAccessError("投稿を指定してください");
    const content = await prisma.content.findFirst({
      where: { id, avatar: { userId } },
      select: { avatarId: true },
    });
    if (!content) throw new JobAccessError("投稿が見つかりません", 404);
    avatarId = content.avatarId;
    clean = { contentId: id };
  } else if (type === "fetch_knowledge") {
    if (typeof data.knowledgeId !== "string")
      throw new JobAccessError("知識を指定してください");
    const knowledge = await prisma.knowledgeItem.findFirst({
      where: { id: data.knowledgeId, avatar: { userId } },
      select: { avatarId: true, sourceUrl: true },
    });
    if (!knowledge || !knowledge.avatarId || !knowledge.sourceUrl)
      throw new JobAccessError("収集対象が見つかりません", 404);
    avatarId = knowledge.avatarId;
    clean = { knowledgeId: data.knowledgeId, url: knowledge.sourceUrl };
  } else if (type === "generate_post") {
    clean = {
      topic: String(data.topic ?? "日々の気づき").slice(0, 2000),
      platform: String(data.platform ?? "x").toLowerCase(),
    };
  } else {
    throw new JobAccessError("このジョブは手動実行できません");
  }
  if (typeof avatarId !== "string")
    throw new JobAccessError("アバターを指定してください");
  const avatar = await prisma.avatar.findFirst({
    where: { id: avatarId, userId },
    select: { id: true, status: true },
  });
  if (!avatar) throw new JobAccessError("アバターが見つかりません", 404);
  if (avatar.status !== "ACTIVE")
    throw new JobAccessError("停止中のアバターは実行できません", 409);
  if (raw.avatarId && raw.avatarId !== avatarId)
    throw new JobAccessError("対象とアバターが一致しません");
  return { avatarId, userId, data: clean };
}
