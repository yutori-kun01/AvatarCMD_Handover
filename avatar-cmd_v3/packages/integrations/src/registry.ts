// ================================================
// @avatar-cmd/integrations — Provider Registry
// ================================================
// Central registry for all SNS providers.
// Postiz-inspired plugin architecture.

import type { Platform, SnsProvider, RateLimitConfig, RateLimitState } from "./provider";

const DEFAULT_RATE_LIMITS: Record<Platform, RateLimitConfig> = {
  x: { maxRequests: 50, windowMs: 15 * 60 * 1000, retryAfterMs: 60_000 },
  instagram: { maxRequests: 30, windowMs: 60 * 60 * 1000, retryAfterMs: 300_000 },
  threads: { maxRequests: 30, windowMs: 60 * 60 * 1000, retryAfterMs: 300_000 },
  youtube: { maxRequests: 10, windowMs: 60 * 60 * 1000, retryAfterMs: 600_000 },
  tiktok: { maxRequests: 20, windowMs: 60 * 60 * 1000, retryAfterMs: 300_000 },
  note: { maxRequests: 10, windowMs: 30 * 60 * 1000, retryAfterMs: 120_000 },
  zenn: { maxRequests: 10, windowMs: 30 * 60 * 1000, retryAfterMs: 120_000 },
  bluesky: { maxRequests: 100, windowMs: 5 * 60 * 1000, retryAfterMs: 30_000 },
  linkedin: { maxRequests: 20, windowMs: 60 * 60 * 1000, retryAfterMs: 300_000 },
  reddit: { maxRequests: 30, windowMs: 60 * 60 * 1000, retryAfterMs: 60_000 },
  medium: { maxRequests: 10, windowMs: 60 * 60 * 1000, retryAfterMs: 300_000 },
  substack: { maxRequests: 5, windowMs: 60 * 60 * 1000, retryAfterMs: 600_000 },
  facebook: { maxRequests: 30, windowMs: 60 * 60 * 1000, retryAfterMs: 300_000 },
  wordpress: { maxRequests: 30, windowMs: 60 * 60 * 1000, retryAfterMs: 60_000 },
  ameba: { maxRequests: 5, windowMs: 60 * 60 * 1000, retryAfterMs: 600_000 },
  standfm: { maxRequests: 5, windowMs: 60 * 60 * 1000, retryAfterMs: 600_000 },
};

export class ProviderRegistry {
  private providers: Map<Platform, SnsProvider> = new Map();
  private rateLimits: Map<string, RateLimitState> = new Map(); // key: `${platform}:${accountId}`
  private requestLogs: Map<string, number[]> = new Map();

  /**
   * Register a provider
   */
  register(provider: SnsProvider): void {
    this.providers.set(provider.platform, provider);
    if (process.env.DEBUG_REGISTRY) console.log(`[Registry] Registered provider: ${provider.displayName} (${provider.platform})`);
  }

  /**
   * Get a provider by platform
   */
  get(platform: Platform): SnsProvider | undefined {
    return this.providers.get(platform);
  }

  /**
   * List all registered providers
   */
  listAll(): SnsProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * List Platform info for UI display
   */
  listPlatformInfo(): {
    platform: Platform;
    displayName: string;
    icon: string;
    authType: string;
    modes: string[];
    maxPostLength: number;
    supportsMedia: boolean;
    supportsScheduling: boolean;
  }[] {
    return this.listAll().map((p) => ({
      platform: p.platform,
      displayName: p.displayName,
      icon: p.icon,
      authType: p.authConfig.primary,
      modes: p.supportedModes,
      maxPostLength: p.maxPostLength,
      supportsMedia: p.supportsMedia,
      supportsScheduling: p.supportsScheduling,
    }));
  }

  /**
   * Check rate limit before executing an action
   */
  checkRateLimit(platform: Platform, accountId: string): RateLimitState {
    const key = `${platform}:${accountId}`;
    const config = DEFAULT_RATE_LIMITS[platform];
    const now = Date.now();

    // Get request history
    let logs = this.requestLogs.get(key) || [];
    logs = logs.filter((t) => now - t < config.windowMs);
    this.requestLogs.set(key, logs);

    const remaining = Math.max(0, config.maxRequests - logs.length);
    const isLimited = remaining === 0;
    const resetAt = new Date(
      logs.length > 0 ? logs[0] + config.windowMs : now + config.windowMs
    );

    const state: RateLimitState = { remaining, resetAt, isLimited };
    this.rateLimits.set(key, state);
    return state;
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest(platform: Platform, accountId: string): void {
    const key = `${platform}:${accountId}`;
    const logs = this.requestLogs.get(key) || [];
    logs.push(Date.now());
    this.requestLogs.set(key, logs);
  }

  /**
   * Check if platform is registered
   */
  has(platform: Platform): boolean {
    return this.providers.has(platform);
  }
}
