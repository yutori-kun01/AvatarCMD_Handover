// ================================================
// SNS アカウント（接続情報は暗号化して SnsAccount.credentials に保存）
// ================================================
import { prisma } from "@avatar-cmd/db";
import type { ConnectedAccount, Credentials } from "../types";
import { getPlatform } from "../platforms";
import { decryptJson, encryptJson, getPlatformApp, getSystemConfig } from "./store";

export async function saveConnectedAccount(avatarId: string, platform: string, acc: ConnectedAccount) {
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

/** 投稿直前に呼ぶ。必要ならトークンを更新して保存し、最新の credentials を返す */
export async function loadFreshCredentials(accountId: string): Promise<{ credentials: Credentials; app: Record<string, string> }> {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId } });
  const def = getPlatform(acc.platform);
  const app = await getPlatformApp(acc.platform);
  let credentials = decryptJson<Credentials>(acc.credentials);
  if (def?.refresh) {
    const refreshed = await def.refresh(app, credentials, await getSystemConfig());
    if (refreshed) {
      credentials = refreshed;
      await prisma.snsAccount.update({
        where: { id: accountId },
        data: {
          credentials: encryptJson(credentials),
          tokenExpiry: typeof credentials.expiresAt === "string" ? new Date(credentials.expiresAt) : null,
        },
      });
    }
  }
  return { credentials, app };
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
