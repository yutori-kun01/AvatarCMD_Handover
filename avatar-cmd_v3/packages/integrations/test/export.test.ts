// アバターのエクスポート / 取り込み（実 DB）: 秘密と運用側のノウハウを含めないこと、取り込みで ID と関連を付け替えること
// DB を使うテストは AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI の使い捨て Postgres で有効。本番 DB では実行しないこと）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { gzipSync } from "node:zlib";
import { Prisma } from "@avatar-cmd/db";
import { collectMediaNames, EXPORT_POLICY, remapIds } from "../src/service/export";

test("エクスポート: アバターに紐づくテーブルはすべて扱いが決まっている（追加し忘れの検出）", () => {
  const roots = new Set(["Avatar", "SnsAccount", "Content", "KnowledgeItem"]);
  const missing = Prisma.dmmf.datamodel.models
    .filter((m) => roots.has(m.name) || m.fields.some((f) => f.kind === "object" && roots.has(f.type) && f.relationFromFields?.length))
    .map((m) => m.name)
    .filter((n) => !(n in EXPORT_POLICY));
  assert.deepEqual(missing, [], `EXPORT_POLICY に追加してください: ${missing.join(", ")}`);
  assert.equal(EXPORT_POLICY.PlatformInsight.include, false, "運用側のノウハウは含めない");
});

test("エクスポート: メディア名の収集と ID の付け替え", () => {
  const name = "0f8fad5b-d9cb-469f-a165-70867728950e.png";
  assert.deepEqual([...collectMediaNames({ a: `/media/${name}`, b: [{ mediaName: name }], c: "no" })], [name]);
  const ids = new Map([["old-1", "new-1"]]);
  assert.deepEqual(remapIds({ x: "old-1", y: ["old-1", "keep"], z: { automationId: "old-1" }, n: 3 }, ids), { x: "new-1", y: ["new-1", "keep"], z: { automationId: "new-1" }, n: 3 });
});

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
const tag = Date.now().toString(36);
const client = `テスト社-${tag}`;
const env = { dir: process.env.MEDIA_DIR, storage: process.env.MEDIA_STORAGE };
let mediaDir = "";
let savedInsights: Record<string, unknown>[] = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

before(async () => {
  if (!hasDb) return;
  mediaDir = mkdtempSync(path.join(tmpdir(), "export-media-"));
  process.env.MEDIA_DIR = mediaDir;
  process.env.MEDIA_STORAGE = "local";
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  savedInsights = await prisma.platformInsight.findMany();
  userId = (await prisma.user.create({ data: { email: `export-${tag}@example.com` } })).id;
});

after(async () => {
  if (!hasDb) return;
  const mine = await prisma.avatar.findMany({ where: { OR: [{ userId }, { name: { endsWith: `-${tag}` } }] }, select: { id: true } });
  const ids = mine.map((a) => a.id);
  await prisma.collaboration.deleteMany({ where: { OR: [{ initiatorId: { in: ids } }, { partnerId: { in: ids } }] } });
  await prisma.avatar.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.platformInsight.deleteMany({});
  if (savedInsights.length) await prisma.platformInsight.createMany({ data: savedInsights as never });
  rmSync(mediaDir, { recursive: true, force: true });
  if (env.dir === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = env.dir;
  if (env.storage === undefined) delete process.env.MEDIA_STORAGE;
  else process.env.MEDIA_STORAGE = env.storage;
});

test("エクスポート → 取り込み: 秘密・運用側のノウハウを含めず、関連を付け替えて取り込む", opts, async () => {
  const icon = await svc.saveMedia(PNG, "icon.png", "image/png");
  const ref = await svc.saveMedia(PNG, "ref.png", "image/png");

  const a = await prisma.avatar.create({
    data: { userId, name: `メイン-${tag}`, clientLabel: client, genre: "health", genreMeta: { source: "auto" }, avatarImageUrl: `/media/${icon.name}`, avatarImageSource: "manual", communication: { tone: "やさしい" } },
  });
  const b = await prisma.avatar.create({ data: { userId, name: `サブ-${tag}`, clientLabel: client } });
  const other = await prisma.avatar.create({ data: { userId, name: `他社-${tag}`, clientLabel: `別-${tag}` } });
  await prisma.collaboration.create({ data: { initiatorId: a.id, partnerId: b.id, title: "共同企画" } });
  await prisma.collaboration.create({ data: { initiatorId: a.id, partnerId: other.id, title: "他社とのコラボ" } });

  const acc = await svc.saveConnectedAccount(a.id, "x", { accountId: `9${tag}`, accountName: "@main", credentials: { accessToken: `SECRET-AT-${tag}`, refreshToken: `SECRET-RT-${tag}` } });
  await prisma.snsAccount.update({ where: { id: acc.id }, data: { accessToken: `SECRET-RAW-${tag}` } });
  await prisma.growthState.create({ data: { snsAccountId: acc.id, phase: { level: 3 } } });
  await prisma.accountSnapshot.create({ data: { snsAccountId: acc.id, date: new Date("2026-11-01"), followers: 120 } });
  const rule = await prisma.automationRule.create({ data: { avatarId: a.id, name: "朝の投稿", triggerType: "schedule", triggerConfig: {}, actionType: "post", actionConfig: { accountIds: [acc.id] }, isActive: true, nextRunAt: new Date() } });
  const published = await prisma.content.create({
    data: {
      avatarId: a.id,
      snsAccountId: acc.id,
      platform: "x",
      content: "眠れない夜、どうしてる？",
      status: "PUBLISHED",
      publishedAt: new Date(),
      engagement: { views: 100, engagements: 5 },
      metadata: { automationId: rule.id, playbook: ["hook:question"], media: [{ name: icon.name }] },
    },
  });
  await prisma.postMetricSnapshot.create({ data: { contentId: published.id, checkpoint: 24, views: 80 } });
  const scheduled = await prisma.content.create({ data: { avatarId: a.id, platform: "x", content: "予約中", status: "SCHEDULED", metadata: {}, campaign: undefined } });
  await prisma.scheduledPost.create({ data: { contentId: scheduled.id, scheduledAt: new Date(Date.now() + 3600_000) } });
  const item = await prisma.revenueItem.create({ data: { avatarId: a.id, name: "note 記事", platform: "note", unitPrice: 500 } });
  await prisma.revenue.create({ data: { avatarId: a.id, source: "note_paid", platform: "note", amount: 500, earnedAt: new Date(), contentId: published.id, itemId: item.id } });
  const k = await prisma.knowledgeItem.create({ data: { avatarId: a.id, title: "朝の光", source: "manual", kind: "learning", scope: { ruleIds: [rule.id] } } });
  await prisma.knowledgeRevision.create({ data: { knowledgeId: k.id, version: 1, snapshot: { title: "朝の光" }, changedBy: "human" } });
  await prisma.styleReference.create({ data: { avatarId: a.id, mediaName: ref.name } });
  const cycle = await prisma.improvementCycle.create({ data: { avatarId: a.id, triggerType: "scheduled", analysis: {}, suggestions: [], scheduledFor: new Date("2026-10-01") } });
  await prisma.improvementSchedule.create({ data: { avatarId: a.id, nextRunAt: new Date("2026-11-20"), lastCycleId: cycle.id } });
  await prisma.decisionEvent.create({ data: { avatarId: a.id, decisionType: "post_gate", engine: "jev", mode: "shadow" } });
  await prisma.platformInsight.create({ data: { platform: "x", genre: "health", feature: "hook:question", lift: 1.3, agree: 1, avatars: 3, clients: 2, posts: 30, computedAt: new Date() } });

  // --- エクスポート ---
  const { bytes, summary } = await svc.exportAvatars({ clientLabel: client });
  assert.deepEqual(summary.avatars.sort(), [`サブ-${tag}`, `メイン-${tag}`].sort());
  const file = svc.decodeExport(bytes);
  const text = JSON.stringify(file);
  assert.ok(!text.includes("SECRET-"), "トークン・認証情報を含めない");
  assert.ok(!/"(accessToken|refreshToken|credentials|sessionData|userId)"/.test(text), "秘密の項目・作成元のユーザーを含めない");
  assert.ok(!text.includes("hook:question") && !text.includes("playbook"), "運用側のノウハウ（傾向）を含めない");
  assert.ok(!text.includes(`他社-${tag}`), "選んでいないクライアントのアバターを含めない");
  assert.equal(file.collaborations.length, 1, "コラボは両方のアバターを含めるときだけ");
  assert.deepEqual(file.media.map((m) => m.name).sort(), [icon.name, ref.name].sort());
  assert.ok(file.schemaVersion.length > 0);
  assert.equal((await svc.exportAvatars({ clientLabel: client, includeMedia: false }).then((r) => svc.decodeExport(r.bytes))).media.length, 0);

  // 取り込み先に画像が無い状態にする
  rmSync(path.join(mediaDir, icon.name));
  rmSync(path.join(mediaDir, ref.name));

  // --- 取り込み ---
  const r = await svc.importAvatars(bytes);
  assert.equal(r.avatars.length, 2);
  assert.equal(r.media.written, 2);
  assert.ok(await svc.mediaExists(icon.name));
  const na = await prisma.avatar.findFirstOrThrow({ where: { id: { in: r.avatars.map((x) => x.id) }, name: `メイン-${tag}` } });
  assert.notEqual(na.id, a.id, "新しい ID で作る");
  assert.equal(na.clientLabel, client);
  assert.equal(na.genre, "health");
  assert.equal(na.avatarImageUrl, `/media/${icon.name}`);

  const nacc = await prisma.snsAccount.findFirstOrThrow({ where: { avatarId: na.id } });
  assert.equal(nacc.isActive, false, "接続アカウントは停止中");
  assert.equal(nacc.credentials, null);
  assert.equal(nacc.accessToken, null);
  assert.match(nacc.lastError ?? "", /接続し直して/);
  assert.ok(await prisma.growthState.findUnique({ where: { snsAccountId: nacc.id } }));
  assert.equal(await prisma.accountSnapshot.count({ where: { snsAccountId: nacc.id } }), 1);

  const nrule = await prisma.automationRule.findFirstOrThrow({ where: { avatarId: na.id } });
  assert.equal(nrule.isActive, false, "自動化ルールは停止");
  assert.equal(nrule.nextRunAt, null);
  assert.deepEqual((nrule.actionConfig as { accountIds: string[] }).accountIds, [nacc.id], "JSON の中の ID も付け替える");

  const ncontents = await prisma.content.findMany({ where: { avatarId: na.id }, include: { metricSnapshots: true, scheduledPost: true } });
  const np = ncontents.find((c) => c.status === "PUBLISHED")!;
  assert.equal(np.snsAccountId, nacc.id);
  assert.equal((np.metadata as Record<string, unknown>).automationId, nrule.id);
  assert.equal(np.metricSnapshots.length, 1);
  const ns = ncontents.find((c) => c.content === "予約中")!;
  assert.equal(ns.status, "DRAFT", "予約中の投稿は下書きに戻す");
  assert.equal(ns.scheduledPost, null);

  const nrev = await prisma.revenue.findFirstOrThrow({ where: { avatarId: na.id } });
  assert.equal(nrev.contentId, np.id);
  assert.equal(nrev.itemId, (await prisma.revenueItem.findFirstOrThrow({ where: { avatarId: na.id } })).id);
  const nk = await prisma.knowledgeItem.findFirstOrThrow({ where: { avatarId: na.id }, include: { revisions: true } });
  assert.equal(nk.revisions.length, 1);
  assert.deepEqual((nk.scope as { ruleIds: string[] }).ruleIds, [nrule.id]);
  assert.equal(await prisma.styleReference.count({ where: { avatarId: na.id } }), 1);
  const nsched = await prisma.improvementSchedule.findUniqueOrThrow({ where: { avatarId: na.id } });
  assert.equal(nsched.lastCycleId, (await prisma.improvementCycle.findFirstOrThrow({ where: { avatarId: na.id } })).id);
  assert.equal(await prisma.decisionEvent.count({ where: { avatarId: na.id } }), 0, "判定ログは含めない");
  assert.equal(await prisma.collaboration.count({ where: { initiatorId: na.id } }), 1);
  // 元のアバターはそのまま
  assert.equal((await prisma.snsAccount.findUniqueOrThrow({ where: { id: acc.id } })).isActive, true);
});

test("取り込み: 壊れたファイル・別の形式・新しい版のファイルは取り込まない", opts, async () => {
  await assert.rejects(svc.importAvatars(Buffer.from("not gzip")), /エクスポートしたファイル/);
  await assert.rejects(svc.importAvatars(gzipSync(Buffer.from(JSON.stringify({ format: "other" })))), /エクスポートファイルではありません/);
  const newer = { format: "avatar-cmd-export", version: 1, schemaVersion: "99991231000000_future", exportedAt: "", avatars: [], collaborations: [], media: [], missingMedia: [] };
  await assert.rejects(svc.importAvatars(gzipSync(Buffer.from(JSON.stringify(newer)))), /新しい版/);
  await assert.rejects(svc.importAvatars(gzipSync(Buffer.from(JSON.stringify({ ...newer, schemaVersion: "", version: 2 })))), /新しい形式/);
  await assert.rejects(svc.exportAvatars({ clientLabel: `存在しない-${tag}` }), /アバターがありません/);
  await assert.rejects(svc.exportAvatars({}), /選んでください/);
});
