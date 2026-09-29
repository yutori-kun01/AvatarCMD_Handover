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

export type OAuthMode = "redirect" | "external";
const STATE_TTL_MS = 15 * 60_000;

async function beginOAuth(platform: string, avatarId: string, mode: OAuthMode) {
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
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  // 期限切れの行を掃除（別ブラウザ接続の結果は元の画面が読み取れるよう、期限後もしばらく残す）
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
  await prisma.oAuthState.create({
    data: { state, platform, avatarId, codeVerifier: pkce?.verifier, redirectUri, expiresAt, mode },
  });
  return { url, state, expiresAt };
}

/** この画面で認可する: 認可画面の URL を返す */
export async function startOAuth(platform: string, avatarId: string): Promise<string> {
  return (await beginOAuth(platform, avatarId, "redirect")).url;
}

/**
 * 別ブラウザで認可する: コピー用の認可 URL を返す。
 * 別ブラウザでは Avatar CMD にログインしていなくてよい（state が1回限りの合言葉になる）。
 * 元の画面は getOAuthLinkStatus(state) をポーリングして完了を知る
 */
export async function createOAuthLink(platform: string, avatarId: string) {
  return beginOAuth(platform, avatarId, "external");
}

/** コールバックで、結果をどう返すか（リダイレクト or 完了ページ）を決めるのに使う */
export async function getOAuthMode(state: string): Promise<OAuthMode | null> {
  const row = await prisma.oAuthState.findUnique({ where: { state }, select: { mode: true } });
  return row ? (row.mode as OAuthMode) : null;
}

/** 別ブラウザ接続の結果を記録する（元の画面に伝える） */
export async function recordOAuthResult(state: string, result: { ok: boolean; message: string }) {
  // 最初の結果だけを残す（使用済みの URL を開き直しても、成功の結果を上書きしない）
  await prisma.oAuthState.updateMany({ where: { state, result: null }, data: { result: JSON.stringify(result), completedAt: new Date() } });
}

export type OAuthLinkStatus = { status: "pending" | "done" | "expired" | "unknown"; ok?: boolean; message?: string };

export async function getOAuthLinkStatus(state: string): Promise<OAuthLinkStatus> {
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row || row.mode !== "external") return { status: "unknown" };
  if (row.result) return { status: "done", ...(JSON.parse(row.result) as { ok: boolean; message: string }) };
  if (row.expiresAt < new Date()) return { status: "expired" };
  return { status: "pending" };
}

export async function finishOAuth(platform: string, state: string, code: string) {
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row || row.platform !== platform) throw new ConfigError("認可リクエストが見つかりません。もう一度「接続」からやり直してください");
  // 1回限り: 未使用のときだけ使用済みにできる（同じ state の二重使用を防ぐ）
  const claimed = await prisma.oAuthState.updateMany({ where: { state, completedAt: null }, data: { completedAt: new Date() } });
  if (!claimed.count) throw new ConfigError("この認可リクエストは使用済みです。もう一度「接続」からやり直してください");
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
