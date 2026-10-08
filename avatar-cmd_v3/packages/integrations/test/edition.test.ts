// 配布版（買い切りプラン）: X / Threads / note だけを使え、それ以外は「準備中」で受け付けない
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { ENABLED_PLATFORMS, isPlatformEnabled, PLATFORM_LIST } from "../src/index";

test("有効なのは X / Threads / note だけ", () => {
  assert.deepEqual([...(ENABLED_PLATFORMS ?? [])].sort(), ["note", "threads", "x"]);
  assert.deepEqual(PLATFORM_LIST.filter((p) => isPlatformEnabled(p.id)).map((p) => p.id).sort(), ["note", "threads", "x"]);
  for (const id of ["instagram", "facebook", "youtube", "tiktok", "linkedin", "reddit", "bluesky", "wordpress", "zenn", "medium", "substack", "ameba", "standfm"]) {
    assert.equal(isPlatformEnabled(id), false, id);
  }
});

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `edition-test-${tag}@example.com`, name: "test" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `E-${tag}` } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

test("準備中のプラットフォームは接続・アプリ登録・投稿を受け付けない", opts, async () => {
  await assert.rejects(svc.connectWithCredentials("bluesky", avatarId, { identifier: "me.bsky.social", appPassword: "xxxx" }), /準備中/);
  await assert.rejects(svc.startOAuth("instagram", avatarId), /準備中/);
  await assert.rejects(svc.savePlatformApp("linkedin", { clientId: "ID", clientSecret: "SECRET" }), /準備中/);

  // 準備中になる前に接続していたアカウントがあっても投稿しない
  const acc = await prisma.snsAccount.create({ data: { avatarId, platform: "bluesky", authType: "credentials", accountName: "@old", accountId: "old" } });
  await assert.rejects(svc.createPosts({ accountIds: [acc.id], text: "hello" }), /準備中/);
  assert.equal(await prisma.content.count({ where: { snsAccountId: acc.id } }), 0);
});
