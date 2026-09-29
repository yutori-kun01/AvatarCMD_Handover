// ================================================
// OAuth 認可フロー（開始 → コールバック）
// ================================================
import { randomBytes } from "crypto";
import { prisma } from "@avatar-cmd/db";
import { getPlatform } from "../platforms";
import { base64url, ConfigError, createPkce } from "../http";
import { getSystemConfig, resolvePlatformApp } from "./store";
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
  // アバター専用の開発者アプリがあればそちらで認可する
  const { app } = await resolvePlatformApp(platform, avatarId);
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
  const { app, scope } = await resolvePlatformApp(platform, row.avatarId);
  const system = await getSystemConfig();
  const accounts = await def.oauth!.exchangeCode(app, {
    code,
    redirectUri: row.redirectUri,
    codeVerifier: row.codeVerifier ?? undefined,
    system,
  });
  const saved = [];
  for (const acc of accounts) saved.push(await saveConnectedAccount(row.avatarId, platform, acc, scope));
  await prisma.activityLog.create({
    data: {
      avatarId: row.avatarId,
      action: "account_connected",
      category: "security",
      level: "success",
      description: `${def.name} を接続しました: ${accounts.map((a) => a.accountName).join(", ")}${scope === "avatar" ? "（アバター専用アプリ）" : ""}`,
    },
  });
  return saved;
}

/**
 * 接続したアカウントが別のアバターにも接続されていれば、その警告文を返す。
 * X / Threads の認可画面はブラウザでログイン中のアカウントで許可されるため、
 * 別アカウントでログインし直さずに接続すると、2つ目のアバターにも1つ目と同じアカウントがつながってしまう。
 */
export async function sameAccountWarnings(saved: { avatarId: string; platform: string; accountId: string | null; accountName: string }[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of saved) {
    if (!s.accountId) continue;
    const others = await prisma.snsAccount.findMany({
      where: { platform: s.platform, accountId: s.accountId, avatarId: { not: s.avatarId } },
      include: { avatar: { select: { name: true } } },
    });
    if (others.length) {
      out.push(
        `${s.accountName} はアバター「${others.map((o) => o.avatar.name).join("」「")}」にも接続されています。別のアカウントを接続したい場合は、ブラウザでそのアカウントにログインし直してから再接続してください`
      );
    }
  }
  return out;
}

/** OAuth 以外（アプリパスワード・トークン・Cookie 等）で接続する */
export async function connectWithCredentials(platform: string, avatarId: string, input: Record<string, string>) {
  const def = getPlatform(platform);
  if (!def?.connect) throw new ConfigError(`${platform} はこの方法で接続できません`);
  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
  if (!avatar) throw new ConfigError("アバターが見つかりません");
  const { app, scope } = await resolvePlatformApp(platform, avatarId);
  const acc = await def.connect(app, input, await getSystemConfig());
  const saved = await saveConnectedAccount(avatarId, platform, acc, scope);
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
