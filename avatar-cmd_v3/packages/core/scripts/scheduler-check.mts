// ================================================
// スケジューラ tick の回帰チェック
// ================================================
// PostgreSQL と Redis が起動している状態で実行する。
//   DATABASE_URL=... REDIS_URL=... pnpm --filter @avatar-cmd/core check:scheduler
// 失敗時は終了コード 1 を返す。
//
// テスト用のルールは [TEST] 接頭辞を付けて作り、最後に必ず削除する。

import { prisma } from "@avatar-cmd/db";
import { getAppQueue, getQueueStats, closeQueues } from "@avatar-cmd/queue";
import { runSchedulerTick } from "../src/scheduler/tick";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`  ${ok ? "OK " : "NG "} ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
}

async function cleanup() {
  await prisma.automationRule.deleteMany({ where: { name: { startsWith: "[TEST]" } } });
  await prisma.content.deleteMany({ where: { content: { startsWith: "[TEST]" } } });
}

async function main() {
  if (process.env.ALLOW_DISPOSABLE_TEST_DATABASE !== "yes") throw new Error("専用の空DBとRedisを指定し、ALLOW_DISPOSABLE_TEST_DATABASE=yes を設定してください。本番環境では実行しないでください。");
  const avatar = await prisma.avatar.findFirst({ orderBy: { name: "asc" } });
  if (!avatar) throw new Error("アバターが居ません。先に db:seed を実行してください");

  await cleanup();
  await getAppQueue().obliterate({ force: true }).catch(() => undefined);

  const rule = await prisma.automationRule.create({
    data: {
      avatarId: avatar.id,
      name: "[TEST] 毎分の投稿生成",
      triggerType: "schedule",
      triggerConfig: { cron: "* * * * *" },
      actionType: "generate",
      actionConfig: { topic: "テスト用トピック" },
    },
  });

  console.log("── 初回 tick は基準時刻を入れるだけ（過去分をまとめて走らせない）");
  let t = await runSchedulerTick();
  let r = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
  check("発火しない", t.rulesFired === 0, t);
  check("lastExecutedAt が入る", r.lastExecutedAt !== null);
  check("executionCount は 0", r.executionCount === 0, r.executionCount);

  console.log("── lastExecutedAt を10分前に戻すと発火する");
  await prisma.automationRule.update({
    where: { id: rule.id },
    data: { lastExecutedAt: new Date(Date.now() - 10 * 60_000) },
  });
  t = await runSchedulerTick();
  r = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
  check("1件発火", t.rulesFired === 1, t);
  check("executionCount が増える", r.executionCount === 1, r.executionCount);
  let stats = await getQueueStats(getAppQueue());
  check("キューに1件入る", stats.waiting + stats.active + stats.completed === 1, stats);

  console.log("── 直後の tick では二重発火しない");
  t = await runSchedulerTick();
  check("発火しない", t.rulesFired === 0, t);
  stats = await getQueueStats(getAppQueue());
  check("キューは増えない", stats.waiting + stats.active + stats.completed === 1, stats);

  console.log("── 無効なルールは評価対象外");
  await prisma.automationRule.update({
    where: { id: rule.id },
    data: { isActive: false, lastExecutedAt: new Date(Date.now() - 600_000) },
  });
  t = await runSchedulerTick();
  check("評価対象に含まれない", t.rulesEvaluated === 0 && t.rulesFired === 0, t);

  console.log("── 不正な cron はエラーを記録して他に影響させない");
  await prisma.automationRule.update({
    where: { id: rule.id },
    data: { isActive: true, triggerConfig: { cron: "not-a-cron" } },
  });
  t = await runSchedulerTick();
  r = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
  check("発火しない", t.rulesFired === 0, t);
  check("lastError が記録される", (r.lastError ?? "").includes("cron"), r.lastError);

  console.log("── 未対応の actionType もエラーを記録する");
  await prisma.automationRule.update({
    where: { id: rule.id },
    data: {
      triggerConfig: { cron: "* * * * *" },
      actionType: "teleport",
      lastExecutedAt: new Date(Date.now() - 600_000),
      lastError: null,
    },
  });
  t = await runSchedulerTick();
  r = await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
  check("発火しない", t.rulesFired === 0, t);
  check("lastError が記録される", (r.lastError ?? "").includes("actionType"), r.lastError);

  console.log("── 期限が来た予約投稿が publish_post として投入される");
  const content = await prisma.content.create({
    data: {
      avatarId: avatar.id,
      platform: "x",
      content: "[TEST] 予約投稿の本文",
      status: "SCHEDULED",
      scheduledPost: { create: { scheduledAt: new Date(Date.now() - 60_000) } },
    },
    include: { scheduledPost: true },
  });
  t = await runSchedulerTick();
  check("1件投入", t.scheduledPostsFired === 1, t);
  let sp = await prisma.scheduledPost.findUniqueOrThrow({ where: { contentId: content.id } });
  check("processing になる", sp.status === "processing", sp.status);
  check("attempts が増える", sp.attempts === 1, sp.attempts);

  console.log("── 同じ予約投稿は二重投入されない");
  t = await runSchedulerTick();
  check("投入されない", t.scheduledPostsFired === 0, t);
  sp = await prisma.scheduledPost.findUniqueOrThrow({ where: { contentId: content.id } });
  check("attempts は増えない", sp.attempts === 1, sp.attempts);

  console.log("── 未来の予約投稿は発火しない");
  await prisma.scheduledPost.update({
    where: { contentId: content.id },
    data: { status: "pending", scheduledAt: new Date(Date.now() + 3600_000) },
  });
  t = await runSchedulerTick();
  check("投入されない", t.scheduledPostsFired === 0, t);

  console.log("── PUBLISHING のまま放置された Content は REVIEW に移す");
  const stuck = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "note", content: "[TEST] 放置された投稿", status: "PUBLISHING" },
  });
  // updatedAt は @updatedAt なので SQL で直接過去にする
  await prisma.$executeRaw`UPDATE contents SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = ${stuck.id}`;
  t = await runSchedulerTick();
  let stuckAfter = await prisma.content.findUniqueOrThrow({ where: { id: stuck.id } });
  check("掃除対象になる", t.stalePublishing === 1, t.stalePublishing);
  check("status=REVIEW", stuckAfter.status === "REVIEW", stuckAfter.status);

  console.log("── 直近に更新された PUBLISHING は掃除しない");
  const fresh = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "note", content: "[TEST] 進行中の投稿", status: "PUBLISHING" },
  });
  t = await runSchedulerTick();
  const freshAfter = await prisma.content.findUniqueOrThrow({ where: { id: fresh.id } });
  check("掃除されない", t.stalePublishing === 0, t.stalePublishing);
  check("PUBLISHING のまま", freshAfter.status === "PUBLISHING", freshAfter.status);

  await prisma.content.deleteMany({ where: { content: { startsWith: "[TEST]" } } });
  await prisma.content.delete({ where: { id: content.id } }).catch(() => undefined);
  await cleanup();
  await getAppQueue().obliterate({ force: true }).catch(() => undefined);

  console.log();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECKS FAILED`);
}

main()
  .catch(async (error) => {
    console.error(error);
    if (process.env.ALLOW_DISPOSABLE_TEST_DATABASE === "yes") await cleanup().catch(() => undefined);
    process.exit(1);
  })
  .finally(async () => {
    await closeQueues();
    await prisma.$disconnect();
    // Prisma / ioredis の接続が残って終了しないことがあるため明示的に抜ける
    process.exit(failures > 0 ? 1 : 0);
  });
