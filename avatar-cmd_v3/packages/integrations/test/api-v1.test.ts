// 外部 AI 用 API v1 の結合テスト（実 DB）。AVATAR_CMD_DB_TESTS=1 のときだけ実行
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/service/api-keys";

test("ログ用の伏せ字: API キー・Bearer トークンを残さない", () => {
  assert.equal(redact("auth failed for acmd_AbCdEfGhIj_secretsecretsecretsecret"), "auth failed for acmd_***");
  assert.equal(redact("Authorization: Bearer xyz.abc"), "Authorization: Bearer ***");
});

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let mine = "";
let other = "";
let accountId = "";
let otherAccountId = "";
const keyIds: string[] = [];

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `apiv1-${tag}@example.com` } })).id;
  mine = (await prisma.avatar.create({ data: { userId, name: `API可-${tag}` } })).id;
  other = (await prisma.avatar.create({ data: { userId, name: `API不可-${tag}` } })).id;
  const cred = { accessToken: "AT", username: "me", expiresAt: new Date(Date.now() + 86400_000).toISOString() };
  accountId = (await svc.saveConnectedAccount(mine, "x", { accountId: `91${tag}`, accountName: "@mine", credentials: cred })).id;
  otherAccountId = (await svc.saveConnectedAccount(other, "x", { accountId: `92${tag}`, accountName: "@other", credentials: cred })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.apiAuditLog.deleteMany({ where: { keyId: { in: keyIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { keyId: { in: keyIds } } });
  await prisma.apiRateCounter.deleteMany({ where: { keyId: { in: keyIds } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keyIds } } });
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

async function issue(scopes: string[], o: { allAvatars?: boolean; avatarIds?: string[] } = {}) {
  const k = await svc.issueApiKey({ name: `test-${scopes.join("+")}`, scopes, avatarIds: o.avatarIds ?? [mine], allAvatars: o.allAvatars });
  keyIds.push(k.id);
  return k;
}

function call(key: string | null, method: string, path: string, body?: unknown, idem?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (idem) headers["idempotency-key"] = idem;
  return svc.handleApiV1(new Request(`https://cmd.example.com/api/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}

test("認証: キー無し・不正・失効・期限切れは 401。平文キーは DB に保存しない", opts, async () => {
  assert.equal((await call(null, "GET", "me")).status, 401);
  assert.equal((await call("acmd_AAAAAAAAAA_wrongwrongwrongwrongwrong", "GET", "me")).status, 401);
  const k = await issue(["read"]);
  const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: k.id } });
  assert.ok(!JSON.stringify(row).includes(k.key.split("_")[2]));
  const me = await call(k.key, "GET", "me");
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json()).scopes, ["read"]);
  await svc.revokeApiKey(k.id);
  const r = await call(k.key, "GET", "me");
  assert.equal(r.status, 401);
  assert.match((await r.json()).error.message, /失効/);
  const e = await issue(["read"]);
  await prisma.apiKey.update({ where: { id: e.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call(e.key, "GET", "me")).status, 401);
  // 発行時の検証
  await assert.rejects(svc.issueApiKey({ name: "x", scopes: ["read"] }), /アバター/);
  await assert.rejects(svc.issueApiKey({ name: "x", scopes: ["admin"], allAvatars: true }), /不明な権限/);
});

test("権限: スコープ不足は 403、操作できないアバターは 404（存在を推測させない）", opts, async () => {
  const k = await issue(["read"]);
  const r = await call(k.key, "POST", "drafts", { accountIds: [accountId], text: "x" }, "idem-scope-0001");
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, "insufficient_scope");
  assert.equal((await call(k.key, "GET", `avatars/${other}`)).status, 404);
  assert.equal((await call(k.key, "GET", `drafts?avatarId=${other}`)).status, 404);
  const list = await (await call(k.key, "GET", "avatars")).json();
  assert.deepEqual(list.avatars.map((a: { id: string }) => a.id), [mine]);

  const w = await issue(["draft"]);
  const bad = await call(w.key, "POST", "drafts", { accountIds: [otherAccountId], text: "他人のアカウント" }, "idem-scope-0002");
  assert.equal(bad.status, 404);
});

test("下書き → 承認（publish 権限）→ 予約の取り消し。書き込みは Idempotency-Key 必須で、同じ要求は1回だけ実行", opts, async () => {
  const k = await issue(["read", "draft", "publish"]);
  assert.equal((await call(k.key, "POST", "drafts", { accountIds: [accountId], text: "本文" })).status, 400);

  const body = { accountIds: [accountId], text: "API からの下書き" };
  // 並行に同じキーで2回送っても、作られる下書きは1件
  const [a, b] = await Promise.all([call(k.key, "POST", "drafts", body, "idem-draft-0001"), call(k.key, "POST", "drafts", body, "idem-draft-0001")]);
  const statuses = [a.status, b.status].sort();
  assert.ok(statuses[0] === 201 && (statuses[1] === 201 || statuses[1] === 409), `statuses ${statuses}`);
  const again = await call(k.key, "POST", "drafts", body, "idem-draft-0001");
  assert.equal(again.status, 201);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  const draftId = (await again.json()).drafts[0].id;
  assert.equal(await prisma.content.count({ where: { avatarId: mine, content: "API からの下書き" } }), 1);
  // 同じキーで本文を変えると 409
  assert.equal((await call(k.key, "POST", "drafts", { ...body, text: "別" }, "idem-draft-0001")).status, 409);

  const ap = await call(k.key, "POST", `drafts/${draftId}/approve`, { scheduledAt: new Date(Date.now() + 3600_000).toISOString() }, "idem-approve-001");
  assert.equal(ap.status, 200);
  assert.equal((await ap.json()).post.status, "SCHEDULED");
  const cancel = await call(k.key, "POST", `scheduled/${draftId}/cancel`, { reason: "見直し" }, "idem-cancel-0001");
  assert.equal(cancel.status, 200);
  const c = await cancel.json();
  assert.equal(c.post.status, "DRAFT");
  assert.match(c.post.heldReason, /外部 API で予約を取り消し/);

  // 監査ログ: 本文・キーは残さない
  const logs = await prisma.apiAuditLog.findMany({ where: { keyId: k.id } });
  assert.ok(logs.length >= 5);
  assert.ok(logs.every((l) => !JSON.stringify(l).includes(k.key.split("_")[2]) && !JSON.stringify(l).includes("API からの下書き")));
  assert.ok(logs.some((l) => l.status === 409));
});

test("自動化ルール: rules:write で作成・停止（承認範囲は必須）", opts, async () => {
  const k = await issue(["read", "rules:write"]);
  const noApproval = await call(k.key, "POST", "rules", { avatarId: mine, name: "API ルール", trigger: { type: "interval", hours: 24 }, action: { accountIds: [accountId], topics: ["a"], mode: "auto" } }, "idem-rule-00001");
  assert.equal(noApproval.status, 400);
  assert.match((await noApproval.json()).error.message, /自動承認の範囲/);
  const ok = await call(k.key, "POST", "rules", { avatarId: mine, name: "API ルール", trigger: { type: "interval", hours: 24 }, action: { accountIds: [accountId], topics: ["a"], mode: "auto", approval: "strict" } }, "idem-rule-00002");
  assert.equal(ok.status, 201);
  const id = (await ok.json()).rule.id;
  const off = await call(k.key, "PATCH", `rules/${id}`, { isActive: false, holdQueued: true }, "idem-rule-00003");
  assert.equal(off.status, 200);
  assert.equal((await off.json()).rule.isActive, false);
  assert.equal((await call(k.key, "POST", "rules", { avatarId: other, name: "x", trigger: { type: "interval", hours: 24 }, action: { accountIds: [otherAccountId], topics: ["a"], mode: "draft" } }, "idem-rule-00004")).status, 404);
});

test("ナレッジ: knowledge:write で追加・編集・差し戻し、read で関連検索", opts, async () => {
  const k = await issue(["read", "knowledge:write"]);
  const noSource = await call(k.key, "POST", "knowledge", { avatarId: mine, kind: "fact", title: "睡眠と集中" }, "idem-know-00001");
  assert.equal(noSource.status, 400);
  const created = await call(k.key, "POST", "knowledge", { avatarId: mine, kind: "fact", title: "睡眠と集中", summary: "睡眠不足は注意力を下げる", sourceUrl: "https://example.com/sleep", tags: ["睡眠"] }, "idem-know-00002");
  assert.equal(created.status, 201);
  const id = (await created.json()).item.id;
  const edited = await call(k.key, "PATCH", `knowledge/${id}`, { summary: "変更後", reason: "テスト" }, "idem-know-00003");
  assert.equal((await edited.json()).item.version, 2);
  const reverted = await call(k.key, "POST", `knowledge/${id}/revert`, { version: 1 }, "idem-know-00004");
  const rv = (await reverted.json()).item;
  assert.equal(rv.summary, "睡眠不足は注意力を下げる");
  assert.equal(rv.version, 3);
  const s = await (await call(k.key, "GET", `knowledge/search?avatarId=${mine}&q=${encodeURIComponent("睡眠のコツ")}`)).json();
  assert.equal(s.items[0].id, id);
  assert.equal((await call(k.key, "GET", `knowledge?avatarId=${other}`)).status, 404);
});

test("レート制限: 書き込みは 1 分あたり上限を超えると 429（Retry-After 付き）", opts, async () => {
  const k = await issue(["draft"]);
  let last: Response | null = null;
  for (let i = 0; i < svc.RATE_LIMITS.write + 1; i++) {
    last = await call(k.key, "DELETE", `drafts/00000000-0000-0000-0000-00000000000${i % 10}`, undefined, `idem-rate-${String(i).padStart(4, "0")}`);
  }
  assert.equal(last!.status, 429);
  assert.ok(Number(last!.headers.get("retry-after")) >= 1);
});
