// ================================================
// 管理画面のセキュリティ — サーバー側のセッション・ログインの回数制限・2 段階認証（TOTP）・ログイン履歴
// ================================================
// ・セッション: Cookie には推測できない乱数（sid）を入れ、DB には sid の SHA-256 だけを保存する（DB が漏れても Cookie は作れない）。
//   ログアウト・パスワード変更・「他の端末をすべてログアウト」で失効させられる。最終操作から IDLE_MS たったものも使えない。
// ・回数制限: 同じ IP からの失敗が WINDOW_MS に PER_IP_FAILURES 回で一時停止。IP を偽装されても総当たりできないよう、
//   全体の失敗が GLOBAL_FAILURES 回を超えたら、すべての IP からのログインを一時停止する（ログイン済みの画面はそのまま使える）。
// ・2 段階認証: RFC 6238 の TOTP（30 秒・6 桁・前後 1 区間まで許容）。同じコードの使い回しは拒否する。
//   秘密鍵は暗号化して保存し、回復コード（10 個）はハッシュだけを保存する（使ったら消す）。
// ・ログイン履歴: AuditLog に成功・失敗・停止・ログアウト・パスワード変更・2 段階認証の変更を IP・ブラウザ付きで残す。

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getSetting, setSetting } from "./store";

const MIN = 60_000;

export const SECURITY_RULES = {
  /** セッションの有効期限（ログインから） */
  sessionTtlMs: 7 * 24 * 60 * MIN,
  /** 最終操作からこの時間がたったセッションは使えない */
  idleMs: 24 * 60 * MIN,
  /** lastSeenAt を書き込む間隔（毎リクエスト書かない） */
  touchEveryMs: 5 * MIN,
  windowMs: 15 * MIN,
  perIpFailures: 5,
  globalFailures: 50,
  /** ログインの試行の記録を残す日数 */
  keepAttemptsDays: 30,
} as const;

export const SECURITY_SETTING_KEYS = {
  totpSecret: "admin_totp_secret",
  totpPending: "admin_totp_pending",
  totpLastCounter: "admin_totp_last_counter",
  recoveryCodes: "admin_recovery_codes",
} as const;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ClientInfo {
  ip: string;
  userAgent?: string | null;
}

// --- ログイン履歴 --------------------------------------------------------------------------

export type SecurityAction =
  | "login_success"
  | "login_failed"
  | "login_blocked"
  | "logout"
  | "password_changed"
  | "sessions_revoked"
  | "totp_enabled"
  | "totp_disabled"
  | "recovery_code_used";

export async function securityAudit(action: SecurityAction, client: ClientInfo, details: Record<string, unknown> = {}) {
  await prisma.auditLog.create({
    data: { action, resource: "admin", details: details as object, ipAddress: client.ip.slice(0, 64), userAgent: client.userAgent?.slice(0, 300) ?? null },
  });
}

export async function listSecurityEvents(limit = 50) {
  return prisma.auditLog.findMany({
    where: { resource: "admin" },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: { id: true, action: true, details: true, ipAddress: true, userAgent: true, createdAt: true },
  });
}

// --- 回数制限 --------------------------------------------------------------------------------

/** ログインを受け付けない理由（受け付けるなら null） */
export async function loginBlockReason(ip: string, now = new Date()): Promise<"ip" | "global" | null> {
  const since = new Date(now.getTime() - SECURITY_RULES.windowMs);
  const [mine, all] = await Promise.all([
    prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }),
    prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
  ]);
  if (mine >= SECURITY_RULES.perIpFailures) return "ip";
  if (all >= SECURITY_RULES.globalFailures) return "global";
  return null;
}

export async function recordLoginAttempt(ip: string, success: boolean, reason?: string) {
  await prisma.loginAttempt.create({ data: { ip: ip.slice(0, 64), success, reason } });
  // 成功したら、その IP の失敗を数え直す（本人が打ち間違えた後に入れたとき、次の打ち間違いですぐ止まらないように）
  if (success) await prisma.loginAttempt.deleteMany({ where: { ip, success: false } });
  // 古い記録は消す（たまに）
  if (Math.random() < 0.05) {
    await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - SECURITY_RULES.keepAttemptsDays * 24 * 60 * MIN) } } });
    await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}

// --- セッション --------------------------------------------------------------------------------

/** 新しいセッション。戻り値の sid を Cookie に入れる（DB にはハッシュだけ） */
export async function createAdminSession(client: ClientInfo, now = new Date()): Promise<{ sid: string; expiresAt: Date }> {
  const sid = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SECURITY_RULES.sessionTtlMs);
  await prisma.adminSession.create({ data: { id: sha256(sid), expiresAt, lastSeenAt: now, ip: client.ip.slice(0, 64), userAgent: client.userAgent?.slice(0, 300) ?? null } });
  return { sid, expiresAt };
}

/** セッションが有効か（失効・期限切れ・放置しすぎは無効）。有効なら最終操作の時刻を更新する */
export async function validateAdminSession(sid: string | undefined, now = new Date()): Promise<boolean> {
  if (!sid || sid.length < 20 || sid.length > 100) return false;
  const row = await prisma.adminSession.findUnique({ where: { id: sha256(sid) } });
  if (!row || row.revokedAt || row.expiresAt <= now || now.getTime() - row.lastSeenAt.getTime() > SECURITY_RULES.idleMs) return false;
  if (now.getTime() - row.lastSeenAt.getTime() > SECURITY_RULES.touchEveryMs) {
    await prisma.adminSession.update({ where: { id: row.id }, data: { lastSeenAt: now } }).catch(() => undefined);
  }
  return true;
}

export async function revokeAdminSession(sid: string | undefined) {
  if (!sid) return;
  await prisma.adminSession.updateMany({ where: { id: sha256(sid), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** すべてのセッションを失効させる（exceptSid は残す）。失効させた数 */
export async function revokeAllAdminSessions(exceptSid?: string): Promise<number> {
  const r = await prisma.adminSession.updateMany({
    where: { revokedAt: null, ...(exceptSid ? { id: { not: sha256(exceptSid) } } : {}) },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

export async function listAdminSessions(currentSid?: string, now = new Date()) {
  const rows = await prisma.adminSession.findMany({
    where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - SECURITY_RULES.idleMs) } },
    orderBy: { lastSeenAt: "desc" },
  });
  const cur = currentSid ? sha256(currentSid) : null;
  return rows.map((r) => ({ createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, expiresAt: r.expiresAt, ip: r.ip, userAgent: r.userAgent, current: r.id === cur }));
}

// --- 2 段階認証（TOTP, RFC 6238） ---------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** ある区間（30 秒ごとの番号）の 6 桁のコード */
export function totpCode(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const totpCounter = (now = Date.now()) => Math.floor(now / 30_000);

/** コードが合っていれば、その区間の番号（前後 1 区間まで許容）。合わなければ null */
export function matchTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const base = totpCounter(now);
  for (const d of [0, -1, 1]) {
    const expected = totpCode(secretB32, base + d);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return base + d;
  }
  return null;
}

export async function totpEnabled(): Promise<boolean> {
  return !!(await getSetting(SECURITY_SETTING_KEYS.totpSecret));
}

/** 設定の開始: 新しい秘密鍵を作り、確認が済むまで仮の場所に置く。認証アプリに登録する URI を返す */
export async function beginTotpSetup(label = "Avatar CMD"): Promise<{ secret: string; uri: string }> {
  if (await totpEnabled()) throw new ConfigError("2 段階認証はすでに有効です（変えるときは一度無効にしてください）");
  const secret = base32Encode(randomBytes(20));
  await setSetting(SECURITY_SETTING_KEYS.totpPending, secret);
  const issuer = "Avatar CMD";
  const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const s = base32Encode(randomBytes(8)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

const normalizeRecovery = (s: string) => s.toLowerCase().replace(/[^a-z2-7]/g, "");

/** 設定の確定: 認証アプリのコードが合えば有効にし、回復コード（このときだけ平文で返す）を作る */
export async function confirmTotpSetup(code: string, client: ClientInfo): Promise<{ recoveryCodes: string[] }> {
  const pending = await getSetting(SECURITY_SETTING_KEYS.totpPending);
  if (!pending) throw new ConfigError("先に「2 段階認証を設定する」を押してください");
  const counter = matchTotp(pending, code);
  if (counter === null) throw new ConfigError("コードが違います。認証アプリに表示されている 6 桁を入れてください（端末の時刻がずれていないかも確認してください）");
  const codes = newRecoveryCodes();
  await setSetting(SECURITY_SETTING_KEYS.totpSecret, pending);
  await setSetting(SECURITY_SETTING_KEYS.totpPending, null);
  await setSetting(SECURITY_SETTING_KEYS.totpLastCounter, String(counter));
  await setSetting(SECURITY_SETTING_KEYS.recoveryCodes, JSON.stringify(codes.map((c) => sha256(normalizeRecovery(c)))));
  await securityAudit("totp_enabled", client);
  return { recoveryCodes: codes };
}

export async function remainingRecoveryCodes(): Promise<number> {
  const raw = await getSetting(SECURITY_SETTING_KEYS.recoveryCodes);
  try {
    return raw ? (JSON.parse(raw) as string[]).length : 0;
  } catch {
    return 0;
  }
}

/**
 * 2 段階目のコードを確かめる（認証アプリの 6 桁、または回復コード）。
 * 同じ 6 桁の使い回しは拒否し、回復コードは一度使ったら消す。
 */
export async function verifySecondFactor(code: string, client: ClientInfo): Promise<boolean> {
  const secret = await getSetting(SECURITY_SETTING_KEYS.totpSecret);
  if (!secret) return true;
  const c = (code ?? "").trim();
  if (/^\d{6}$/.test(c.replace(/\s/g, ""))) {
    const counter = matchTotp(secret, c);
    const last = Number((await getSetting(SECURITY_SETTING_KEYS.totpLastCounter)) ?? "-1");
    if (counter === null || counter <= last) return false;
    await setSetting(SECURITY_SETTING_KEYS.totpLastCounter, String(counter));
    return true;
  }
  const raw = await getSetting(SECURITY_SETTING_KEYS.recoveryCodes);
  const hashes: string[] = raw ? JSON.parse(raw) : [];
  const h = sha256(normalizeRecovery(c));
  const i = hashes.findIndex((x) => x.length === h.length && timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (i < 0) return false;
  hashes.splice(i, 1);
  await setSetting(SECURITY_SETTING_KEYS.recoveryCodes, JSON.stringify(hashes));
  await securityAudit("recovery_code_used", client, { remaining: hashes.length });
  return true;
}

export async function disableTotp(client: ClientInfo) {
  for (const k of Object.values(SECURITY_SETTING_KEYS)) await setSetting(k, null);
  await securityAudit("totp_disabled", client);
}
