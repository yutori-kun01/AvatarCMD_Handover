// ================================================
// SNS アカウント（接続情報は暗号化して SnsAccount.credentials に保存）
// ================================================
import { prisma } from "@avatar-cmd/db";
import type { ConnectedAccount, Credentials } from "../types";
import { getPlatform } from "../platforms";
import { ConfigError } from "../http";
import { appForAccount, decryptJson, encryptJson, getSystemConfig, type AppScope } from "./store";

export async function saveConnectedAccount(avatarId: string, platform: string, acc: ConnectedAccount, appScope: AppScope = "shared") {
  const def = getPlatform(platform);
  const defaults: Record<string, unknown> = {};
  for (const f of def?.settingFields ?? []) if (f.default !== undefined) defaults[f.key] = f.default;

  const data = {
    authType: def?.connection === "oauth" ? "oauth" : "credentials",
    accountName: acc.accountName,
    profileUrl: acc.profileUrl ?? null,
    credentials: encryptJson(acc.credentials),
    tokenExpiry: typeof acc.credentials.expiresAt === "string" ? new Date(acc.credentials.expiresAt) : null,
    oauthScopes: acc.scopes ?? null,
    appScope,
    isActive: true,
    lastError: null,
    healthScore: 100,
    lastSyncAt: new Date(),
  };
  const existing = await prisma.snsAccount.findFirst({ where: { avatarId, platform, accountId: acc.accountId } });
  if (existing) {
    return prisma.snsAccount.update({
      where: { id: existing.id },
      data: { ...data, settings: { ...defaults, ...(existing.settings as object), ...(acc.settings ?? {}) } as object },
    });
  }
  return prisma.snsAccount.create({
    data: { ...data, avatarId, platform, accountId: acc.accountId, settings: { ...defaults, ...(acc.settings ?? {}) } as object },
  });
}

export async function listAccounts() {
  const rows = await prisma.snsAccount.findMany({
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
    include: { avatar: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    avatarId: r.avatarId,
    avatarName: r.avatar.name,
    platform: r.platform,
    accountId: r.accountId,
    accountName: r.accountName,
    profileUrl: r.profileUrl,
    isActive: r.isActive,
    tokenExpiry: r.tokenExpiry,
    lastError: r.lastError,
    settings: r.settings as Record<string, unknown>,
    connected: !!r.credentials,
    appScope: r.appScope,
    updatedAt: r.updatedAt,
  }));
}

export async function updateAccountSettings(id: string, settings: Record<string, unknown>, isActive?: boolean) {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id } });
  const def = getPlatform(acc.platform);
  const allowed = new Set((def?.settingFields ?? []).map((f) => f.key));
  const next = { ...(acc.settings as object) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(settings)) if (allowed.has(k)) next[k] = v;
  return prisma.snsAccount.update({ where: { id }, data: { settings: next as object, ...(isActive === undefined ? {} : { isActive }) } });
}

export async function deleteAccount(id: string) {
  await prisma.snsAccount.delete({ where: { id } });
}

/** 更新後の credentials を保存する */
async function storeCredentials(accountId: string, credentials: Credentials) {
  await prisma.snsAccount.update({
    where: { id: accountId },
    data: {
      credentials: encryptJson(credentials),
      tokenExpiry: typeof credentials.expiresAt === "string" ? new Date(credentials.expiresAt) : null,
      lastError: null,
    },
  });
}

/** 投稿直前に呼ぶ。必要ならトークンを更新して保存し、最新の credentials を返す */
export async function loadFreshCredentials(accountId: string): Promise<{ credentials: Credentials; app: Record<string, string> }> {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId } });
  const def = getPlatform(acc.platform);
  // トークンは発行したのと同じアプリ（共通 or アバター専用）で更新する
  const app = await appForAccount(acc);
  let credentials = decryptJson<Credentials>(acc.credentials);
  if (def?.refresh) {
    const refreshed = await def.refresh(app, credentials, await getSystemConfig());
    if (refreshed) {
      credentials = refreshed;
      await storeCredentials(accountId, credentials);
    }
  }
  return { credentials, app };
}

// --- 認証情報の個別管理 ---------------------------------------------------------

/** 日時として別に表示するキー */
const TIME_KEYS = new Set(["expiresAt", "issuedAt", "refreshExpiresAt"]);
/** 秘密ではないのでそのまま表示してよいキー。これ以外（トークン・Cookie・パスワード等、未知のキー含む）はすべて伏せ字 */
const PUBLIC_KEYS = new Set(["identifier", "service", "siteUrl", "username", "userId", "pageId", "authorId", "repo", "branch"]);

/** 秘密の値の伏せ字: 末尾4文字と長さだけ（照合用）。短い値は全部伏せる */
export function maskSecret(value: string): string {
  return value.length <= 12 ? "●".repeat(8) : `${"●".repeat(8)}${value.slice(-4)}（${value.length}文字）`;
}

/** 画面表示用: アカウントの認証情報の状態。秘密の値はすべて伏せ字 */
export async function describeAccountCredentials(accountId: string) {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId }, include: { avatar: { select: { name: true } } } });
  const def = getPlatform(acc.platform);
  const cred = acc.credentials ? decryptJson<Credentials>(acc.credentials) : {};
  const fields = Object.entries(cred)
    .filter(([k, v]) => !TIME_KEYS.has(k) && (typeof v === "string" || typeof v === "number"))
    .map(([k, v]) => (PUBLIC_KEYS.has(k) ? { key: k, value: String(v), secret: false } : { key: k, value: maskSecret(String(v)), secret: true }));
  return {
    id: acc.id,
    avatarName: acc.avatar.name,
    platform: acc.platform,
    connection: def?.connection ?? "none",
    appScope: acc.appScope as AppScope,
    scopes: acc.oauthScopes,
    expiresAt: typeof cred.expiresAt === "string" ? cred.expiresAt : null,
    issuedAt: typeof cred.issuedAt === "string" ? cred.issuedAt : null,
    hasRefreshToken: typeof cred.refreshToken === "string" && !!cred.refreshToken,
    canRefresh: !!def?.refresh,
    fields,
    updatedAt: acc.updatedAt,
  };
}

/**
 * トークンを今すぐ更新する（期限前でも実行）。
 * 各プラットフォームの refresh は「期限が近いときだけ更新」なので、期限を現在時刻として渡して更新させる。
 */
export async function refreshAccountNow(accountId: string): Promise<{ expiresAt: string | null }> {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId } });
  const def = getPlatform(acc.platform);
  if (!def?.refresh) throw new ConfigError(`${def?.name ?? acc.platform} はトークンの自動更新に対応していません（必要なら再接続してください）`);
  const app = await appForAccount(acc);
  const current = decryptJson<Credentials>(acc.credentials);
  const refreshed = await def.refresh(app, { ...current, expiresAt: new Date().toISOString() }, await getSystemConfig());
  if (!refreshed) {
    // refresh が null を返すのは「リフレッシュトークンが無い」か「発行直後で更新できない（Meta 系は24時間）」とき
    throw new ConfigError("今は更新できません（リフレッシュトークンが無い、または発行直後で更新できない期間です）。必要なら再接続してください");
  }
  await storeCredentials(accountId, refreshed);
  await prisma.activityLog.create({
    data: {
      avatarId: acc.avatarId,
      action: "token_refreshed",
      category: "security",
      level: "success",
      description: `${def.name} (${acc.accountName}) のトークンを更新しました`,
    },
  });
  return { expiresAt: typeof refreshed.expiresAt === "string" ? refreshed.expiresAt : null };
}

/** アバターが1人もいなければ既定のオーナーとアバターを作る（初回起動用） */
export async function ensureDefaultAvatar() {
  const count = await prisma.avatar.count();
  if (count > 0) return;
  const user = await prisma.user.upsert({
    where: { email: "admin@avatar-cmd.local" },
    update: {},
    create: { email: "admin@avatar-cmd.local", name: "Admin", role: "OWNER" },
  });
  await prisma.avatar.create({ data: { userId: user.id, name: "メインアバター", description: "初回起動時に自動作成" } });
}
