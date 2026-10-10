// ================================================
// 管理者パスワード（サーバー専用）
// ================================================
// 優先順: ダッシュボードで設定したパスワード（scrypt ハッシュを暗号化保存）→ 環境変数 ADMIN_PASSWORD
// どちらも無い場合は初回セットアップとして、ログイン画面からパスワードを設定できる。

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getSetting, setSetting, SETTING_KEYS } from "@avatar-cmd/integrations/server";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyHash(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split(":");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function passwordConfigured(): Promise<boolean> {
  return !!process.env.ADMIN_PASSWORD || !!(await getSetting(SETTING_KEYS.adminPasswordHash));
}

export async function checkPassword(pw: string): Promise<boolean> {
  const stored = await getSetting(SETTING_KEYS.adminPasswordHash);
  if (stored) return verifyHash(pw, stored);
  const env = process.env.ADMIN_PASSWORD;
  return !!env && safeEqual(pw, env);
}

export async function setPassword(pw: string): Promise<void> {
  if (pw.length < 10) throw new Error("パスワードは10文字以上にしてください");
  await setSetting(SETTING_KEYS.adminPasswordHash, hashPassword(pw));
  // パスワードを変えたら、それまでのセッション（他の端末・漏れた Cookie）を無効にする
  await bumpSessionEpoch();
}

// --- セッションの世代 ----------------------------------------------------------------
// middleware は毎リクエスト確認するので、DB の値を短時間キャッシュする（このプロセスで変えた値はすぐ反映）
const EPOCH_KEY = "session_epoch";
const EPOCH_TTL_MS = 10_000;
let epochCache: { value: number; at: number } | null = null;

export async function sessionEpoch(): Promise<number> {
  if (epochCache && Date.now() - epochCache.at < EPOCH_TTL_MS) return epochCache.value;
  const value = Number(await getSetting(EPOCH_KEY)) || 0;
  epochCache = { value, at: Date.now() };
  return value;
}

/** 世代を上げる（それまでのセッションをすべて無効にする）。新しい世代を返す */
export async function bumpSessionEpoch(): Promise<number> {
  const next = (Number(await getSetting(EPOCH_KEY)) || 0) + 1;
  await setSetting(EPOCH_KEY, String(next));
  epochCache = { value: next, at: Date.now() };
  return next;
}
