// ==============================================
// Publisher — Content → SNS via integrations registry
// ==============================================
// PUBLISH_MODE=dry-run (default): marks content PUBLISHED with a simulated
//   post id. Lets the whole pipeline run safely without credentials.
// PUBLISH_MODE=live: uses the platform API when the avatar's SnsAccount has
//   credentials; browser-only platforms are dispatched to Chrome Empire.

import { prisma, type Prisma } from "@avatar-cmd/db";
import { createDefaultRegistry, type Platform, type ProviderCredentials, type ProviderRegistry } from "@avatar-cmd/integrations";
import { CredentialVault } from "../security/credential-vault";
import { dispatchBrowserTask } from "./browser-dispatch";

let registry: ProviderRegistry | null = null;
function getRegistry(): ProviderRegistry {
  return (registry ??= createDefaultRegistry());
}

export type PublishMode = "dry-run" | "live";
export function getPublishMode(): PublishMode {
  return process.env.PUBLISH_MODE === "live" ? "live" : "dry-run";
}

export interface PublishOutcome {
  status: "PUBLISHED" | "PUBLISHING" | "FAILED";
  mode: "dry-run" | "api" | "browser";
  postId?: string;
  url?: string;
  error?: string;
}

function decryptMaybe(vault: CredentialVault | null, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (!vault) return undefined;
  try {
    return vault.decrypt(value);
  } catch {
    return undefined;
  }
}

function getVault(): CredentialVault | null {
  try {
    return new CredentialVault();
  } catch {
    return null;
  }
}

async function logActivity(avatarId: string, action: string, description: string, level: string, metadata: Prisma.InputJsonValue = {}) {
  await prisma.activityLog.create({ data: { avatarId, action, category: "sns", description, level, metadata } });
}

/**
 * Publish a single content item. Updates Content + ScheduledPost state
 * and writes an ActivityLog entry. Never throws for expected failures.
 */
export async function publishContent(contentId: string): Promise<PublishOutcome> {
  const content = await prisma.content.findUnique({ where: { id: contentId }, include: { avatar: true, scheduledPost: true } });
  if (!content) throw new Error(`Content not found: ${contentId}`);
  if (content.status === "PUBLISHED") {
    return { status: "PUBLISHED", mode: "dry-run", postId: content.externalPostId ?? undefined, url: content.postUrl ?? undefined };
  }

  const platform = content.platform.toLowerCase() as Platform;
  const provider = getRegistry().get(platform);
  await prisma.content.update({ where: { id: contentId }, data: { status: "PUBLISHING" } });

  let outcome: PublishOutcome;
  if (!provider) {
    outcome = { status: "FAILED", mode: "dry-run", error: `Unsupported platform: ${content.platform}` };
  } else if (content.content.length > provider.maxPostLength) {
    outcome = { status: "FAILED", mode: "dry-run", error: `Content exceeds ${provider.displayName} limit (${provider.maxPostLength})` };
  } else if (getPublishMode() === "dry-run") {
    const postId = `dryrun-${contentId.slice(0, 8)}-${Date.now().toString(36)}`;
    outcome = { status: "PUBLISHED", mode: "dry-run", postId };
  } else {
    outcome = await publishLive(content.avatarId, platform, content.content, contentId);
  }

  const now = new Date();
  await prisma.content.update({
    where: { id: contentId },
    data: {
      status: outcome.status,
      publishedAt: outcome.status === "PUBLISHED" ? now : null,
      externalPostId: outcome.postId ?? null,
      postUrl: outcome.url ?? null,
      metadata: {
        ...((content.metadata as Record<string, unknown>) ?? {}),
        publishMode: outcome.mode,
        ...(outcome.error ? { lastError: outcome.error } : {}),
      },
    },
  });
  if (content.scheduledPost) {
    await prisma.scheduledPost.update({
      where: { id: content.scheduledPost.id },
      data: {
        status: outcome.status === "PUBLISHED" ? "published" : outcome.status === "FAILED" ? "failed" : "processing",
        attempts: { increment: 1 },
        lastError: outcome.error ?? null,
        publishedAt: outcome.status === "PUBLISHED" ? now : null,
      },
    });
  }

  const label = provider?.displayName ?? content.platform;
  if (outcome.status === "PUBLISHED") {
    await logActivity(content.avatarId, "post_published", `${label} に投稿しました${outcome.mode === "dry-run" ? "（ドライラン）" : ""}: ${content.content.slice(0, 40)}`, "success", { contentId, ...outcome });
  } else if (outcome.status === "PUBLISHING") {
    await logActivity(content.avatarId, "post_dispatched", `${label} への投稿をChrome Empireに送信しました`, "info", { contentId, ...outcome });
  } else {
    await logActivity(content.avatarId, "post_failed", `${label} への投稿に失敗: ${outcome.error}`, "error", { contentId, ...outcome });
  }
  return outcome;
}

async function publishLive(avatarId: string, platform: Platform, text: string, contentId: string): Promise<PublishOutcome> {
  const provider = getRegistry().get(platform)!;
  const account = await prisma.snsAccount.findFirst({ where: { avatarId, platform, isActive: true }, orderBy: { updatedAt: "desc" } });
  if (!account) return { status: "FAILED", mode: "api", error: `No active ${provider.displayName} account for this avatar` };

  const vault = getVault();
  const accessToken = decryptMaybe(vault, account.accessToken);
  const credentials: ProviderCredentials = {
    authType: account.authType as ProviderCredentials["authType"],
    operationMode: accessToken && provider.supportedModes.some((m) => m !== "browser") ? "hybrid" : "browser",
    accessToken,
    refreshToken: decryptMaybe(vault, account.refreshToken),
    chromeProfileId: account.id,
    avatarId,
  };

  if (accessToken && provider.postViaApi) {
    try {
      const r = await provider.postViaApi({ text }, credentials);
      if (r.success) return { status: "PUBLISHED", mode: "api", postId: r.postId, url: r.url };
      if (!provider.getPostSteps) return { status: "FAILED", mode: "api", error: r.error };
    } catch (e) {
      if (!provider.getPostSteps) return { status: "FAILED", mode: "api", error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (provider.getPostSteps) {
    const steps = provider.getPostSteps({ text });
    const dispatched = await dispatchBrowserTask({ avatarId, contentId, platform, steps });
    if (dispatched) return { status: "PUBLISHING", mode: "browser" };
    return { status: "FAILED", mode: "browser", error: "Browser mode requires Chrome Empire worker (REDIS_URL not configured)" };
  }
  return { status: "FAILED", mode: "api", error: "No credentials configured" };
}
