// ================================================
// publish_post の回帰チェック
// ================================================
// PostgreSQL と Redis が必要。外部SNSへは実際に投稿しない
// （API 投稿は未登録トークンで失敗し、ブラウザモードはキュー投入で止まる）。
//   DATABASE_URL=... REDIS_URL=... ENCRYPTION_KEY=... \
//     pnpm --filter @avatar-cmd/core check:publish

import { prisma } from "@avatar-cmd/db";
import { closeQueues, getBrowserQueue, getQueueStats } from "@avatar-cmd/queue";
import { CredentialVault } from "../src/security/credential-vault";
import { processJob } from "../src/scheduler/workers";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`  ${ok ? "OK " : "NG "} ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
}

async function cleanup(avatarId: string) {
  await prisma.content.deleteMany({ where: { content: { startsWith: "[TEST]" } } });
  await prisma.snsAccount.deleteMany({ where: { avatarId, accountName: { startsWith: "[TEST]" } } });
}

async function runPublish(contentId: string): Promise<string | null> {
  try {
    await processJob({ id: "test", type: "publish_post", payload: { data: { contentId } } } as never);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main() {
  const avatar = await prisma.avatar.findFirst({ orderBy: { name: "asc" } });
  if (!avatar) throw new Error("アバターが居ません。先に db:seed を実行してください");
  await cleanup(avatar.id);
  await getBrowserQueue().obliterate({ force: true }).catch(() => undefined);

  const vault = new CredentialVault();

  console.log("── SNSアカウント未登録なら FAILED になる");
  let content = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "x", content: "[TEST] アカウント無し", status: "DRAFT" },
  });
  let err = await runPublish(content.id);
  let after = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
  check("例外になる", err !== null && err.includes("SNSアカウント"), err);
  check("status=FAILED", after.status === "FAILED", after.status);

  console.log("── 未対応プラットフォームも FAILED になる");
  content = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "mixi", content: "[TEST] 未対応", status: "DRAFT" },
  });
  err = await runPublish(content.id);
  after = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
  check("例外になる", err !== null && err.includes("未対応"), err);
  check("status=FAILED", after.status === "FAILED", after.status);

  console.log("── ブラウザのみのプラットフォーム(note)はブラウザキューへ回る");
  await prisma.snsAccount.create({
    data: {
      avatarId: avatar.id,
      platform: "note",
      authType: "session",
      accountName: "[TEST] note account",
      accessToken: vault.encrypt("dummy-token"),
    },
  });
  content = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "note", content: "[TEST] ブラウザ投稿の本文", status: "DRAFT" },
  });
  err = await runPublish(content.id);
  after = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
  const browserStats = await getQueueStats(getBrowserQueue());
  check("例外にならない", err === null, err);
  check("status=PUBLISHING のまま", after.status === "PUBLISHING", after.status);
  check("ブラウザキューに1件入る", browserStats.waiting === 1, browserStats);

  const queued = await getBrowserQueue().getJobs(["waiting"]);
  const payload = queued[0]?.data as { kind?: string; operations?: unknown[]; contentId?: string };
  check("kind=operations", payload?.kind === "operations", payload?.kind);
  check("操作列が入っている", (payload?.operations?.length ?? 0) > 0, payload?.operations?.length);
  check("contentId が紐づく", payload?.contentId === content.id, payload?.contentId);

  const log = await prisma.activityLog.findFirst({
    where: { avatarId: avatar.id, action: "post_browser_queued" },
    orderBy: { createdAt: "desc" },
  });
  check("activityLog に記録される", log !== null, log?.description);

  console.log("── API 失敗時（トークンが無効）は FAILED になる");
  await prisma.snsAccount.create({
    data: {
      avatarId: avatar.id,
      platform: "bluesky",
      authType: "app_password",
      accountName: "[TEST] bluesky account",
      accessToken: vault.encrypt("invalid-token"),
    },
  });
  content = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "bluesky", content: "[TEST] API投稿", status: "DRAFT" },
  });
  err = await runPublish(content.id);
  after = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
  check("例外になる", err !== null, err);
  check("status=FAILED", after.status === "FAILED", after.status);

  console.log("── ブラウザ投稿の成功が Content に反映される");
  const browserOk = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "note", content: "[TEST] ブラウザ成功", status: "PUBLISHING" },
  });
  await processJob({
    id: "test",
    type: "browser_result",
    payload: { avatarId: avatar.id, data: { contentId: browserOk.id, success: true, url: "https://note.com/x/n/abc" } },
  } as never);
  after = await prisma.content.findUniqueOrThrow({ where: { id: browserOk.id } });
  check("status=PUBLISHED", after.status === "PUBLISHED", after.status);
  check("postUrl が入る", after.postUrl === "https://note.com/x/n/abc", after.postUrl);
  check("publishedAt が入る", after.publishedAt !== null);

  console.log("── ブラウザ投稿の失敗が Content に反映される");
  const browserNg = await prisma.content.create({
    data: { avatarId: avatar.id, platform: "note", content: "[TEST] ブラウザ失敗", status: "PUBLISHING" },
  });
  await processJob({
    id: "test",
    type: "browser_result",
    payload: { avatarId: avatar.id, data: { contentId: browserNg.id, success: false, error: "セレクタが見つかりません" } },
  } as never);
  after = await prisma.content.findUniqueOrThrow({ where: { id: browserNg.id } });
  check("status=FAILED", after.status === "FAILED", after.status);
  const failLog = await prisma.activityLog.findFirst({
    where: { avatarId: avatar.id, action: "post_failed" },
    orderBy: { createdAt: "desc" },
  });
  check("失敗理由がログに残る", (failLog?.description ?? "").includes("セレクタ"), failLog?.description);

  console.log("── 確定済みの Content は browser_result で上書きされない");
  await processJob({
    id: "test",
    type: "browser_result",
    payload: { avatarId: avatar.id, data: { contentId: browserOk.id, success: false, error: "遅れて来た失敗" } },
  } as never);
  after = await prisma.content.findUniqueOrThrow({ where: { id: browserOk.id } });
  check("PUBLISHED のまま", after.status === "PUBLISHED", after.status);

  console.log("── 既に PUBLISHED なものは二重投稿しない");
  content = await prisma.content.create({
    data: {
      avatarId: avatar.id,
      platform: "x",
      content: "[TEST] 既に公開済み",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  err = await runPublish(content.id);
  after = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
  check("例外にならない", err === null, err);
  check("PUBLISHED のまま", after.status === "PUBLISHED", after.status);

  await cleanup(avatar.id);
  await getBrowserQueue().obliterate({ force: true }).catch(() => undefined);

  console.log();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECKS FAILED`);
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await closeQueues();
    await prisma.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
