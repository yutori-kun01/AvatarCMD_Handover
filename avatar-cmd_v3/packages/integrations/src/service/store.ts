// ================================================
// 設定ストア — ダッシュボードで入力された値を暗号化して DB に保存する
// ================================================
// 暗号鍵 ENCRYPTION_KEY だけは .env に置く（DB の中身を守る鍵なので DB には置けない）。

import { prisma } from "@avatar-cmd/db";
import { CredentialVault } from "../security/credential-vault";
import { DEFAULT_SYSTEM_CONFIG, type SystemConfig } from "../types";
import { getPlatform } from "../platforms";
import { ConfigError } from "../http";

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
  anthropicApiKey: "anthropic_api_key",
  openaiApiKey: "openai_api_key",
  // 用途ごとの AI 割り当ては ai_<用途>_provider / ai_<用途>_model（llm.ts）
  /** TypeSafe（Jev）判定レイヤー（decision.ts） */
  jevApiKey: "jev_api_key",
  jevModel: "jev_model",
  jevMode: "jev_mode",
  /** 動画パイプライン（video-config.ts の VIDEO_SETTING_KEYS と同じ値） */
  videoFishApiKey: "video_fish_api_key",
  videoMeasureToken: "video_measure_token",
  videoKlingAccessKey: "video_kling_access_key",
  videoKlingSecretKey: "video_kling_secret_key",
  /** メディアの保存先（local / r2）と Cloudflare R2 の接続情報（media.ts） */
  mediaStorage: "media_storage",
  r2AccountId: "r2_account_id",
  r2Bucket: "r2_bucket",
  r2AccessKeyId: "r2_access_key_id",
  r2SecretAccessKey: "r2_secret_access_key",
  workerHeartbeat: "worker_heartbeat",
  adminPasswordHash: "admin_password_hash",
} as const;

const SECRET_KEYS = new Set<string>([
  SETTING_KEYS.geminiApiKey,
  SETTING_KEYS.anthropicApiKey,
  SETTING_KEYS.openaiApiKey,
  SETTING_KEYS.jevApiKey,
  SETTING_KEYS.videoFishApiKey,
  SETTING_KEYS.videoMeasureToken,
  SETTING_KEYS.videoKlingAccessKey,
  SETTING_KEYS.videoKlingSecretKey,
  SETTING_KEYS.r2AccessKeyId,
  SETTING_KEYS.r2SecretAccessKey,
  SETTING_KEYS.adminPasswordHash,
]);

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

/** 入力値と既存値から保存する値を作る。password 型が空欄なら既存値を残し、"-" は削除 */
function mergeAppInput(platform: string, current: Record<string, string>, input: Record<string, string>): Record<string, string> {
  const def = getPlatform(platform);
  if (!def) throw new Error(`unknown platform: ${platform}`);
  const next: Record<string, string> = {};
  for (const f of def.appFields) {
    const v = (input[f.key] ?? "").trim();
    if (v === "-") continue;
    if (!v && f.type === "password" && current[f.key]) next[f.key] = current[f.key];
    else if (v) next[f.key] = v;
  }
  return next;
}

/**
 * 保存。password 型の項目が空欄なら既存値を残す（画面に秘密を戻さないため）。
 * 値に "-" だけを入れると削除。
 */
export async function savePlatformApp(platform: string, input: Record<string, string>): Promise<void> {
  const next = mergeAppInput(platform, await getPlatformApp(platform), input);
  if (!Object.keys(next).length) {
    await prisma.platformApp.deleteMany({ where: { platform } });
    return;
  }
  const config = encryptJson(next);
  await prisma.platformApp.upsert({ where: { platform }, update: { config }, create: { platform, config } });
}

function describeApp(platform: string, app: Record<string, string>) {
  const def = getPlatform(platform);
  const values: Record<string, string> = {};
  const configured: Record<string, boolean> = {};
  for (const f of def?.appFields ?? []) {
    configured[f.key] = !!app[f.key];
    values[f.key] = f.type === "password" ? (app[f.key] ? CredentialVault.mask(app[f.key]) : "") : app[f.key] ?? "";
  }
  const complete = (def?.appFields ?? []).filter((f) => f.required).every((f) => !!app[f.key]);
  return { values, configured, complete };
}

/** 画面表示用。秘密の値は伏せ字にする */
export async function describePlatformApp(platform: string) {
  return describeApp(platform, await getPlatformApp(platform));
}

// --- アバター専用の開発者アプリ（共通設定を上書き） ---------------------------
// アバターごとに別の開発者アプリ（X / Meta など）を使いたい場合に登録する。
// 登録されていればそのアバターの接続・トークン更新はこちらを使う。

export type AppScope = "shared" | "avatar";

export async function getAvatarPlatformApp(avatarId: string, platform: string): Promise<Record<string, string> | null> {
  const row = await prisma.avatarPlatformApp.findUnique({ where: { avatarId_platform: { avatarId, platform } } });
  return row ? decryptJson<Record<string, string>>(row.config) : null;
}

/** アバター専用アプリを保存。必須項目がそろわない場合はエラー（中途半端な上書きで共通アプリが使えなくなるのを防ぐ） */
export async function saveAvatarPlatformApp(avatarId: string, platform: string, input: Record<string, string>): Promise<void> {
  const def = getPlatform(platform);
  if (!def || !def.appFields.length) throw new ConfigError(`${platform} はアプリ登録が不要です`);
  const next = mergeAppInput(platform, (await getAvatarPlatformApp(avatarId, platform)) ?? {}, input);
  const missing = def.appFields.filter((f) => f.required && !next[f.key]).map((f) => f.label);
  if (missing.length) throw new ConfigError(`必須項目が未入力です: ${missing.join("、")}`);
  const config = encryptJson(next);
  await prisma.avatarPlatformApp.upsert({
    where: { avatarId_platform: { avatarId, platform } },
    update: { config },
    create: { avatarId, platform, config },
  });
}

export async function deleteAvatarPlatformApp(avatarId: string, platform: string): Promise<void> {
  await prisma.avatarPlatformApp.deleteMany({ where: { avatarId, platform } });
}

export async function describeAvatarPlatformApp(avatarId: string, platform: string) {
  const app = await getAvatarPlatformApp(avatarId, platform);
  return app ? describeApp(platform, app) : null;
}

/** 画面表示用: 全アバターの専用アプリの登録状況 */
export async function listAvatarPlatformApps() {
  const rows = await prisma.avatarPlatformApp.findMany({ orderBy: [{ avatarId: "asc" }, { platform: "asc" }] });
  return rows.map((r) => ({ avatarId: r.avatarId, platform: r.platform, ...describeApp(r.platform, decryptJson<Record<string, string>>(r.config)), updatedAt: r.updatedAt }));
}

/** 新しく接続するときに使うアプリ: アバター専用があればそれ、無ければ共通 */
export async function resolvePlatformApp(platform: string, avatarId: string): Promise<{ app: Record<string, string>; scope: AppScope }> {
  const own = await getAvatarPlatformApp(avatarId, platform);
  if (own) return { app: own, scope: "avatar" };
  return { app: await getPlatformApp(platform), scope: "shared" };
}

/** 接続済みアカウントのトークン更新に使うアプリ: 接続時と同じアプリ */
export async function appForAccount(acc: { avatarId: string; platform: string; appScope: string }): Promise<Record<string, string>> {
  if (acc.appScope === "avatar") {
    const own = await getAvatarPlatformApp(acc.avatarId, acc.platform);
    if (!own) throw new ConfigError("このアカウントはアバター専用アプリで接続されていますが、そのアプリ設定が削除されています。再接続してください");
    return own;
  }
  return getPlatformApp(acc.platform);
}

export function mask(value: string) {
  return CredentialVault.mask(value);
}
