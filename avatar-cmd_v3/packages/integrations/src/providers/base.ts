// ================================================
// @avatar-cmd/integrations — Base Provider
// ================================================
// Abstract base class with dual-mode (API + Browser) logic.
// Concrete providers override API and/or Browser methods.

import type {
  SnsProvider,
  Platform,
  OperationMode,
  AuthConfig,
  PostContent,
  PostResult,
  AccountMetrics,
  EngagementAction,
  AuthTokens,
  ProviderCredentials,
  BrowserOperation,
} from "../provider";

export abstract class BaseProvider implements SnsProvider {
  abstract readonly platform: Platform;
  abstract readonly displayName: string;
  abstract readonly icon: string;
  abstract readonly maxPostLength: number;
  abstract readonly supportsMedia: boolean;
  abstract readonly supportsScheduling: boolean;
  abstract readonly supportedModes: OperationMode[];
  abstract readonly authConfig: AuthConfig;

  /**
   * Unified post — auto-selects API or Browser mode
   */
  async post(content: PostContent, credentials: ProviderCredentials): Promise<PostResult> {
    const mode = this.resolveMode(credentials.operationMode);

    if ((mode === "api" || mode === "hybrid") && this.postViaApi) {
      try {
        const result = await this.postViaApi(content, credentials);
        if (result.success || mode === "api") return result;
        // Hybrid fallback to browser
      } catch {
        if (mode === "api") {
          return { success: false, error: "API mode failed", platform: this.platform, mode: "api" };
        }
      }
    }

    // Browser mode
    if (this.getPostSteps) {
      const steps = this.getPostSteps(content);
      return {
        success: false,
        error: `Browser mode: ${steps.length} steps prepared. Execute via Chrome Empire.`,
        platform: this.platform,
        mode: "browser",
      };
    }

    return { success: false, error: "No supported operation mode", platform: this.platform, mode };
  }

  /**
   * Unified metrics — auto-selects mode
   */
  async getMetrics(credentials: ProviderCredentials): Promise<AccountMetrics> {
    const mode = this.resolveMode(credentials.operationMode);

    if ((mode === "api" || mode === "hybrid") && this.getMetricsViaApi) {
      try {
        return await this.getMetricsViaApi(credentials);
      } catch {
        if (mode === "api") throw new Error("API metrics fetch failed");
      }
    }

    // Browser fallback — returns empty, metrics collected via Chrome Empire
    return { followers: 0, following: 0, posts: 0, engagement: 0 };
  }

  /**
   * Unified engage — auto-selects mode
   */
  async engage(action: EngagementAction, credentials: ProviderCredentials): Promise<boolean> {
    const mode = this.resolveMode(credentials.operationMode);

    if ((mode === "api" || mode === "hybrid") && this.engageViaApi) {
      try {
        return await this.engageViaApi(action, credentials);
      } catch {
        if (mode === "api") return false;
      }
    }
    return false;
  }

  // --- Mode Resolution ---
  private resolveMode(requested: OperationMode): OperationMode {
    if (this.supportedModes.includes(requested)) return requested;
    return this.supportedModes[0] || "browser";
  }

  // --- Override Points (optional) ---
  postViaApi?(content: PostContent, credentials: ProviderCredentials): Promise<PostResult>;
  getMetricsViaApi?(credentials: ProviderCredentials): Promise<AccountMetrics>;
  engageViaApi?(action: EngagementAction, credentials: ProviderCredentials): Promise<boolean>;
  deletePostViaApi?(postId: string, credentials: ProviderCredentials): Promise<boolean>;
  getLoginSteps?(credentials: ProviderCredentials): BrowserOperation[];
  getPostSteps?(content: PostContent): BrowserOperation[];
  getMetricsSteps?(): BrowserOperation[];
  getEngageSteps?(action: EngagementAction): BrowserOperation[];
  getSearchSteps?(query: string): BrowserOperation[];
  getAuthUrl?(redirectUri: string): Promise<string>;
  handleCallback?(code: string, redirectUri: string): Promise<AuthTokens>;
  refreshToken?(refreshToken: string): Promise<AuthTokens>;

  // --- Default Validation ---
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    if (credentials.operationMode === "browser") {
      return !!(credentials.chromeProfileId || credentials.sessionCookies);
    }
    return !!(credentials.accessToken || credentials.apiKey || credentials.appPassword);
  }
}
