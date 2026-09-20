import { authorizeJob, validateCron } from "@avatar-cmd/core";
export async function automationInput(
  userId: string,
  avatarId: string,
  body: Record<string, any>,
) {
  if (typeof body.name !== "string" || !body.name.trim())
    throw new Error("ルール名を入力してください");
  if (body.triggerType !== "schedule")
    throw new Error("定期実行を選択してください");
  const cron = body.triggerConfig?.cron;
  if (
    typeof cron !== "string" ||
    !/^([\d*,/\-]+\s+){4}[\d*,/\-]+$/.test(cron.trim())
  )
    throw new Error("cronを5項目で指定してください");
  validateCron(cron);
  const types = {
    generate: "generate_post",
    post: "generate_post",
    publish: "publish_post",
    knowledge: "fetch_knowledge",
    scrape: "fetch_knowledge",
  } as const;
  const type = types[body.actionType as keyof typeof types];
  if (!type) throw new Error("対応していない操作です");
  const job = await authorizeJob(userId, type, {
    avatarId,
    data: body.actionConfig,
  });
  return {
    name: body.name.trim(),
    triggerType: "schedule",
    triggerConfig: { cron: cron.trim() },
    actionType: body.actionType as string,
    actionConfig: job.data ?? {},
  };
}
