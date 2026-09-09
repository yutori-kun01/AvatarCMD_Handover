// ================================================
// @avatar-cmd/integrations — Provider Interface v2
// ================================================
// Dual-mode architecture: API + Browser (Playwright)
// Each platform supports one or both operation modes.
// Browser mode uses Chrome Empire for Playwright-based
// interaction (NOT scraping — real browser operation).

// --- Platforms ---
export type Platform =
  | "x"
  | "instagram"
  | "threads"
  | "youtube"
  | "tiktok"
  | "note"
  | "zenn"
  | "bluesky"
  | "linkedin"
  | "reddit"
  | "medium"
  | "substack"
  | "facebook"
  | "wordpress"
  | "ameba"
  | "standfm";

// --- Operation Mode ---
// api:     公式APIを使用（レート制限あり、安定）
// browser: Playwright経由でブラウザ操作（API非対応操作、情報収集）
// hybrid:  API優先 → ブラウザフォールバック
export type OperationMode = "api" | "browser" | "hybrid";

// --- Auth ---
export type AuthType = "oauth" | "session" | "app_password" | "api_key" | "cookie";

export interface AuthConfig {
  primary: AuthType;           // メインの認証方式
  fallback?: AuthType;         // フォールバック認証
  oauthScopes?: string[];      // OAuth必要スコープ
  requiresBrowser?: boolean;   // ブラウザログインが必要か
}

// --- Content ---
export interface PostContent {
  text: string;
  media?: { type: "image" | "video" | "audio"; url: string; alt?: string }[];
  link?: string;
  tags?: string[];
  scheduleAt?: Date;
  metadata?: Record<string, unknown>; // Platform-specific fields
}

export interface PostResult {
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
  platform: Platform;
  mode: OperationMode; // どのモードで実行されたか
}

// --- Metrics ---
export interface AccountMetrics {
  followers: number;
  following: number;
  posts: number;
  engagement: number;
  impressions?: number;
  recentPosts?: {
    id: string;
    text: string;
    likes: number;
    comments: number;
    shares: number;
    views?: number;
    date: string;
  }[];
}

// --- Engagement ---
export interface EngagementAction {
  type: "like" | "reply" | "repost" | "bookmark" | "follow" | "comment";
  targetUrl: string;
  content?: string;
}

// --- Auth Tokens ---
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
}

// --- Credentials ---
export interface ProviderCredentials {
  authType: AuthType;
  operationMode: OperationMode; // API or Browser or Hybrid
  // API認証
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  appPassword?: string;
  // ブラウザ認証
  sessionCookies?: Record<string, string>;
  chromeProfileId?: string; // Chrome Empire のプロファイルID
  avatarId?: string;
}

// --- Browser Task (Chrome Empire 連携用) ---
export interface BrowserOperation {
  action: "login" | "post" | "read" | "engage" | "collect_metrics" | "search" | "navigate";
  url: string;
  selectors?: Record<string, string>;  // CSS selectors for UI elements
  inputData?: Record<string, string>;  // Form data
  waitFor?: string;                    // Selector to wait for
  timeout?: number;
}

// ================================================
// SnsProvider Interface v2
// ================================================
export interface SnsProvider {
  readonly platform: Platform;
  readonly displayName: string;
  readonly icon: string;
  readonly maxPostLength: number;
  readonly supportsMedia: boolean;
  readonly supportsScheduling: boolean;
  readonly supportedModes: OperationMode[]; // どのモードに対応しているか
  readonly authConfig: AuthConfig;

  // --- Authentication ---
  getAuthUrl?(redirectUri: string): Promise<string>;
  handleCallback?(code: string, redirectUri: string): Promise<AuthTokens>;
  refreshToken?(refreshToken: string): Promise<AuthTokens>;

  // --- API Mode Operations ---
  postViaApi?(content: PostContent, credentials: ProviderCredentials): Promise<PostResult>;
  getMetricsViaApi?(credentials: ProviderCredentials): Promise<AccountMetrics>;
  engageViaApi?(action: EngagementAction, credentials: ProviderCredentials): Promise<boolean>;
  deletePostViaApi?(postId: string, credentials: ProviderCredentials): Promise<boolean>;

  // --- Browser Mode Operations ---
  // Returns BrowserOperation[] for Chrome Empire to execute
  getLoginSteps?(credentials: ProviderCredentials): BrowserOperation[];
  getPostSteps?(content: PostContent): BrowserOperation[];
  getMetricsSteps?(): BrowserOperation[];
  getEngageSteps?(action: EngagementAction): BrowserOperation[];
  getSearchSteps?(query: string): BrowserOperation[];

  // --- Unified Interface (auto-selects mode) ---
  post(content: PostContent, credentials: ProviderCredentials): Promise<PostResult>;
  getMetrics?(credentials: ProviderCredentials): Promise<AccountMetrics>;
  engage?(action: EngagementAction, credentials: ProviderCredentials): Promise<boolean>;

  // --- Validation ---
  validateCredentials(credentials: ProviderCredentials): Promise<boolean>;
}

// --- Rate Limiting ---
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryAfterMs: number;
}

export interface RateLimitState {
  remaining: number;
  resetAt: Date;
  isLimited: boolean;
}
