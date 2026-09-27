// ================================================
// OAuth 認可フロー（開始 → コールバック）
// ================================================
import { randomBytes } from "crypto";
import { prisma } from "@avatar-cmd/db";
import { getPlatform } from "../platforms";
import { base64url, ConfigError, createPkce } from "../http";
import { getPlatformApp, getSystemConfig } from "./store";
import { saveConnectedAccount } from "./accounts";

export function redirectUriFor(appUrl: string, platform: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/oauth/${platform}/callback`;
}

export async function startOAuth(platform: string, avatarId: string): Promise<string> {
  const def = getPlatform(platform);
  if (!def?.oauth) throw new ConfigError(`${platform} は OAuth 接続に対応していません`);
  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
  if (!avatar) throw new ConfigError("アバターが見つかりません");
  const system = await getSystemConfig();
  const app = await getPlatformApp(platform);
  const redirectUri = redirectUriFor(system.appUrl, platform);
  const state = base64url(randomBytes(24));
  const pkce = def.oauth.pkce ? createPkce() : undefined;
  const url = def.oauth.authorizeUrl(app, { redirectUri, state, codeChallenge: pkce?.challenge, system });

  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.oAuthState.create({
    data: { state, platform, avatarId, codeVerifier: pkce?.verifier, redirectUri, expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  return url;
}

export async function finishOAuth(platform: string, state: string, code: string) {
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row || row.platform !== platform) throw new ConfigError("認可リクエストが見つかりません。もう一度「接続」からやり直してください");
  await prisma.oAuthState.delete({ where: { state } });
  if (row.expiresAt < new Date()) throw new ConfigError("認可の有効期限が切れました。もう一度やり直してください");

  const def = getPlatform(platform)!;
  const app = await getPlatformApp(platform);
  const system = await getSystemConfig();
  const accounts = await def.oauth!.exchangeCode(app, {
    code,
    redirectUri: row.redirectUri,
    codeVerifier: row.codeVerifier ?? undefined,
    system,
  });
  const saved = [];
  for (const acc of accounts) saved.push(await saveConnectedAccount(row.avatarId, platform, acc));
  await prisma.activityLog.create({
    data: {
      avatarId: row.avatarId,
      action: "account_connected",
      category: "security",
      level: "success",
      description: `${def.name} を接続しました: ${accounts.map((a) => a.accountName).join(", ")}`,
    },
  });
  return saved;
}

/** OAuth 以外（アプリパスワード・トークン・Cookie 等）で接続する */
export async function connectWithCredentials(platform: string, avatarId: string, input: Record<string, string>) {
  const def = getPlatform(platform);
  if (!def?.connect) throw new ConfigError(`${platform} はこの方法で接続できません`);
  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
  if (!avatar) throw new ConfigError("アバターが見つかりません");
  const acc = await def.connect(await getPlatformApp(platform), input, await getSystemConfig());
  const saved = await saveConnectedAccount(avatarId, platform, acc);
  await prisma.activityLog.create({
    data: {
      avatarId,
      action: "account_connected",
      category: "security",
      level: "success",
      description: `${def.name} を接続しました: ${acc.accountName}`,
    },
  });
  return saved;
}
