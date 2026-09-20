import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@avatar-cmd/db";
import { processJob } from "../src/scheduler/workers";
const id = randomUUID();
async function main() {
  if (process.env.ALLOW_DISPOSABLE_TEST_DATABASE !== "yes") throw new Error("専用のテストDBを指定し、ALLOW_DISPOSABLE_TEST_DATABASE=yes を設定してください");
  await prisma.user.create({ data: { id, email: `${id}@test.invalid`, name: "Regression fixture" } });
  try {
    const avatar = await prisma.avatar.create({ data: { userId: id, name: "Regression", role: "test" } });
    const post = await prisma.content.create({ data: { avatarId: avatar.id, platform: "x", content: "Synthetic", status: "DRAFT" } });
    const publish = () => processJob({ id: "test", type: "publish_post", payload: { userId: id, avatarId: avatar.id, data: { contentId: post.id } } });
    await publish();
    assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: post.id } })).status, "DRAFT");
    await prisma.content.update({ where: { id: post.id }, data: { status: "APPROVED" } });
    await assert.rejects(publish(), /アカウント/);
    await prisma.content.update({ where: { id: post.id }, data: { status: "PUBLISHING", metadata: { publishAttemptId: "current" } } });
    const result = (attemptId: string, success = true) => processJob({ id: "result", type: "browser_result", payload: { avatarId: avatar.id, data: { contentId: post.id, attemptId, success, url: "https://example.com/post/1" } } });
    await result("stale");
    assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: post.id } })).status, "PUBLISHING");
    await result("current");
    assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: post.id } })).status, "PUBLISHED");
    await result("current", false);
    assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: post.id } })).status, "PUBLISHED");
    console.log("5 DB publication checks passed (no external posts)");
  } finally { await prisma.user.delete({ where: { id } }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
