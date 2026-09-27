// ================================================
// 設定ストア — ダッシュボードで入力された値を暗号化して DB に保存する
// ================================================
// 暗号鍵 ENCRYPTION_KEY だけは .env に置く（DB の中身を守る鍵なので DB には置けない）。

import { prisma } from "@avatar-cmd/db";
import { CredentialVault } from "@avatar-cmd/core/src/security/credential-vault";
import { DEFAULT_SYSTEM_CONFIG, type SystemConfig } from "../types";
import { getPlatform } from "../platforms";

let vault: CredentialVault | null = null;
export function getVault(): CredentialVault {
  if (!vault) vault = new CredentialVault();
  return vault;
}

export function encryptJson(value: unknown): string {
  return getVault().encrypt(JSON.stringify(value));
}
export function decryptJson<T = Record<string, unknown>>(value: string | null | undefined): T {
  if (!value) return {} as T;
  return JSON.parse(getVault().decrypt(value)) as T;
}

// --- システム設定 ---------------------------------------------------------

export const SETTING_KEYS = {
  appUrl: "app_url",
  metaGraphVersion: "meta_graph_version",
  linkedinVersion: "linkedin_version",
  geminiApiKey: "gemini_api_key",
  geminiModel: "gemini_model",
  workerHeartbeat: "worker_heartbeat",
  adminPasswordHash: "admin_password_hash",
} as const;

const SECRET_KEYS = new Set<string>([SETTING_KEYS.geminiApiKey, SETTING_KEYS.adminPasswordHash]);

export async function getSetting(key: string): Promise<string | undefined> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return undefined;
  return row.secret ? getVault().decrypt(row.value) : row.value;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null || value === "") {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  const secret = SECRET_KEYS.has(key);
  const stored = secret ? getVault().encrypt(value) : value;
  await prisma.appSetting.upsert({ where: { key }, update: { value: stored, secret }, create: { key, value: stored, secret } });
}

export async function getSystemConfig(): Promise<SystemConfig> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [SETTING_KEYS.appUrl, SETTING_KEYS.metaGraphVersion, SETTING_KEYS.linkedinVersion] } },
  });
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    appUrl: (m[SETTING_KEYS.appUrl] || process.env.APP_URL || DEFAULT_SYSTEM_CONFIG.appUrl).replace(/\/+$/, ""),
    metaGraphVersion: m[SETTING_KEYS.metaGraphVersion] || DEFAULT_SYSTEM_CONFIG.metaGraphVersion,
    linkedinVersion: m[SETTING_KEYS.linkedinVersion] || DEFAULT_SYSTEM_CONFIG.linkedinVersion,
  };
}

// --- 開発者アプリ（Client ID / Secret 等） ------------------------------

export async function getPlatformApp(platform: string): Promise<Record<string, string>> {
  const row = await prisma.platformApp.findUnique({ where: { platform } });
  return row ? decryptJson<Record<string, string>>(row.config) : {};
}

/**
 * 保存。password 型の項目が空欄なら既存値を残す（画面に秘密を戻さないため）。
 * 値に "-" だけを入れると削除。
 */
export async function savePlatformApp(platform: string, input: Record<string, string>): Promise<void> {
  const def = getPlatform(platform);
  if (!def) throw new Error(`unknown platform: ${platform}`);
  const current = await getPlatformApp(platform);
  const next: Record<string, string> = {};
  for (const f of def.appFields) {
    const v = (input[f.key] ?? "").trim();
    if (v === "-") continue;
    if (!v && f.type === "password" && current[f.key]) next[f.key] = current[f.key];
    else if (v) next[f.key] = v;
  }
  if (!Object.keys(next).length) {
    await prisma.platformApp.deleteMany({ where: { platform } });
    return;
  }
  const config = encryptJson(next);
  await prisma.platformApp.upsert({ where: { platform }, update: { config }, create: { platform, config } });
}

/** 画面表示用。秘密の値は伏せ字にする */
export async function describePlatformApp(platform: string) {
  const def = getPlatform(platform);
  const app = await getPlatformApp(platform);
  const values: Record<string, string> = {};
  const configured: Record<string, boolean> = {};
  for (const f of def?.appFields ?? []) {
    configured[f.key] = !!app[f.key];
    values[f.key] = f.type === "password" ? (app[f.key] ? CredentialVault.mask(app[f.key]) : "") : app[f.key] ?? "";
  }
  const complete = (def?.appFields ?? []).filter((f) => f.required).every((f) => !!app[f.key]);
  return { values, configured, complete };
}

export function mask(value: string) {
  return CredentialVault.mask(value);
}
