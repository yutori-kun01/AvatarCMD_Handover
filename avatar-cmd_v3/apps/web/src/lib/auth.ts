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
}
