// 管理画面のセキュリティ: TOTP（RFC 6238 の検証用の値）・Cookie の署名・CSRF の判定は単体、
// セッション・回数制限・2 段階認証の保存は実 DB（AVATAR_CMD_DB_TESTS=1 のときだけ。本番 DB では実行しないこと）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, matchTotp, totpCode } from "../src/service/admin-security";
import { createSessionToken, crossSiteWrite, readCookie, readSessionToken } from "../../../apps/web/src/lib/session";

test("TOTP: RFC 6238 の検証用の値と一致する（SHA-1・6 桁）", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(base32Decode(secret).toString(), "12345678901234567890");
  // RFC 6238 付録 B（8 桁の下 6 桁）
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [t, code] of vectors) assert.equal(totpCode(secret, Math.floor(t / 30)), code, `T=${t}`);
  // 前後 1 区間（30 秒）まで受け付け、2 区間ずれたら受け付けない
  const now = 1234567890_000;
  assert.equal(matchTotp(secret, "005924", now), Math.floor(1234567890 / 30));
  assert.equal(matchTotp(secret, totpCode(secret, Math.floor(now / 30_000) + 1), now), Math.floor(now / 30_000) + 1);
  assert.equal(matchTotp(secret, totpCode(secret, Math.floor(now / 30_000) + 2), now), null);
  assert.equal(matchTotp(secret, "12345", now), null);
  assert.equal(matchTotp(secret, "abcdef", now), null);
});

test("Cookie: 署名と期限を確かめ、改ざん・期限切れ・形式違いは受け付けない", async () => {
  const prev = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret";
  try {
    const sid = "A".repeat(43);
    const token = await createSessionToken(sid, Date.now() + 60_000);
    assert.equal(await readSessionToken(token), sid);
    const [exp, , sig] = token.split(".");
    assert.equal(await readSessionToken(`${exp}.${"B".repeat(43)}.${sig}`), null, "sid の差し替え");
    assert.equal(await readSessionToken(`${Number(exp) + 1}.${sid}.${sig}`), null, "期限の延長");
    assert.equal(await readSessionToken(await createSessionToken(sid, Date.now() - 1)), null, "期限切れ");
    assert.equal(await readSessionToken(`${exp}.${sig}`), null, "古い形式");
    assert.equal(await readSessionToken(undefined), null);
    assert.equal(readCookie("a=1; acmd_session=x%2Ey; b=2", "acmd_session"), "x.y");
  } finally {
    if (prev === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prev;
  }
});

test("CSRF: 他のサイトからの書き込みだけを断る", () => {
  const req = (method: string, headers: Record<string, string>) => new Request("https://cmd.example.com/api/avatars", { method, headers });
  assert.equal(crossSiteWrite(req("POST", { host: "cmd.example.com", origin: "https://cmd.example.com" })), false);
  assert.equal(crossSiteWrite(req("POST", { host: "web:3000", "x-forwarded-host": "cmd.example.com", origin: "https://cmd.example.com" })), false, "プロキシ経由");
  assert.equal(crossSiteWrite(req("POST", { host: "cmd.example.com", origin: "https://evil.example" })), true);
  assert.equal(crossSiteWrite(req("DELETE", { host: "cmd.example.com", "sec-fetch-site": "cross-site" })), true);
  assert.equal(crossSiteWrite(req("POST", { host: "cmd.example.com", origin: "null" })), true);
  assert.equal(crossSiteWrite(req("GET", { host: "cmd.example.com", origin: "https://evil.example" })), false, "読み取りは対象外");
  assert.equal(crossSiteWrite(req("POST", { host: "cmd.example.com" })), false, "Origin の無いブラウザ以外の呼び出し（Cookie が無ければ認証で断る）");
});

// --- 実 DB ---------------------------------------------------------------------------------

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
const KEYS = ["admin_totp_secret", "admin_totp_pending", "admin_totp_last_counter", "admin_recovery_codes"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const client = { ip: "203.0.113.10", userAgent: "test" };

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: KEYS } } });
  await prisma.loginAttempt.deleteMany({});
});

after(async () => {
  if (!hasDb) return;
  await prisma.appSetting.deleteMany({ where: { key: { in: KEYS } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.loginAttempt.deleteMany({});
  await prisma.adminSession.deleteMany({ where: { ip: { startsWith: "203.0.113." } } });
  await prisma.auditLog.deleteMany({ where: { resource: "admin", ipAddress: { startsWith: "203.0.113." } } });
});

test("回数制限: 同じ IP の失敗が続くとその IP を、全体の失敗が多いとすべてを止める", opts, async () => {
  const ip = "203.0.113.20";
  for (let i = 0; i < svc.SECURITY_RULES.perIpFailures - 1; i++) await svc.recordLoginAttempt(ip, false, "password");
  assert.equal(await svc.loginBlockReason(ip), null);
  await svc.recordLoginAttempt(ip, false, "password");
  assert.equal(await svc.loginBlockReason(ip), "ip");
  assert.equal(await svc.loginBlockReason("203.0.113.21"), null, "他の IP は止めない");
  // 時間がたてば受け付ける
  assert.equal(await svc.loginBlockReason(ip, new Date(Date.now() + svc.SECURITY_RULES.windowMs + 1000)), null);
  // IP を変えながらの総当たり（偽装）: 全体の失敗で止める
  await prisma.loginAttempt.createMany({ data: Array.from({ length: svc.SECURITY_RULES.globalFailures }, (_, i) => ({ ip: `198.51.100.${i % 250}`, success: false })) });
  assert.equal(await svc.loginBlockReason("203.0.113.99"), "global");
  await prisma.loginAttempt.deleteMany({});
});

test("セッション: 失効・放置・期限切れは使えず、他の端末だけをまとめてログアウトできる", opts, async () => {
  const a = await svc.createAdminSession(client);
  const b = await svc.createAdminSession({ ...client, ip: "203.0.113.11" });
  assert.equal(await svc.validateAdminSession(a.sid), true);
  assert.equal(await svc.validateAdminSession("x".repeat(43)), false, "存在しない sid");
  // DB には sid そのものを保存しない
  assert.equal(await prisma.adminSession.count({ where: { id: a.sid } }), 0);

  // 放置しすぎ
  assert.equal(await svc.validateAdminSession(a.sid, new Date(Date.now() + svc.SECURITY_RULES.idleMs + 60_000)), false);
  // 期限切れ
  assert.equal(await svc.validateAdminSession(a.sid, new Date(a.expiresAt.getTime() + 1)), false);

  // a 以外をログアウト
  const n = await svc.revokeAllAdminSessions(a.sid);
  assert.ok(n >= 1);
  assert.equal(await svc.validateAdminSession(b.sid), false);
  assert.equal(await svc.validateAdminSession(a.sid), true);
  const list = await svc.listAdminSessions(a.sid);
  assert.ok(list.some((s) => s.current));
  await svc.revokeAdminSession(a.sid);
  assert.equal(await svc.validateAdminSession(a.sid), false, "ログアウトしたら使えない");
});

test("2 段階認証: 確認してから有効にし、同じコードの使い回しを断り、回復コードは 1 回だけ使える", opts, async () => {
  assert.equal(await svc.totpEnabled(), false);
  assert.equal(await svc.verifySecondFactor("", client), true, "無効のときは確かめない");
  const { secret, uri } = await svc.beginTotpSetup();
  assert.match(uri, /^otpauth:\/\/totp\/.*secret=[A-Z2-7]+/);
  await assert.rejects(svc.confirmTotpSetup("abcdef", client), /コードが違います/);
  assert.equal(await svc.totpEnabled(), false, "確認できるまでは有効にしない");
  const first = await svc.confirmTotpSetup(svc.totpCode(secret, svc.totpCounter()), client);
  assert.equal(first.recoveryCodes.length, 10);
  assert.equal(await svc.totpEnabled(), true);
  // 秘密鍵は暗号化して保存
  const row = await prisma.appSetting.findUniqueOrThrow({ where: { key: "admin_totp_secret" } });
  assert.equal(row.secret, true);
  assert.ok(!row.value.includes(secret));

  // 有効化で使ったコード（同じ区間）は使い回せない
  const cur = svc.totpCode(secret, svc.totpCounter());
  assert.equal(await svc.verifySecondFactor(cur, client), false, "使用済みの区間");
  // 次の区間のコードは通る
  assert.equal(await svc.verifySecondFactor(svc.totpCode(secret, svc.totpCounter() + 1), client), true);
  assert.equal(await svc.verifySecondFactor("123456", client), false);

  // 回復コード: ハッシュだけを保存し、1 回だけ使える
  await svc.disableTotp(client);
  const s2 = await svc.beginTotpSetup();
  const { recoveryCodes } = await svc.confirmTotpSetup(svc.totpCode(s2.secret, svc.totpCounter()), client);
  const stored = await prisma.appSetting.findUniqueOrThrow({ where: { key: "admin_recovery_codes" } });
  assert.ok(!stored.value.includes(recoveryCodes[0]));
  assert.equal(await svc.verifySecondFactor(recoveryCodes[0].toUpperCase(), client), true, "大文字・区切りの違いは無視");
  assert.equal(await svc.verifySecondFactor(recoveryCodes[0], client), false, "2 回目は使えない");
  assert.equal(await svc.remainingRecoveryCodes(), 9);

  await svc.disableTotp(client);
  assert.equal(await svc.totpEnabled(), false);
  const events = await svc.listSecurityEvents(20);
  assert.ok(events.some((e) => e.action === "totp_enabled") && events.some((e) => e.action === "recovery_code_used"));
});
