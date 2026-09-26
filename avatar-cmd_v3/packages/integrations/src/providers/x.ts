// ================================================
// X (Twitter) — Hybrid: API + Browser
// ================================================

import type {
  Platform, OperationMode, AuthConfig,
  PostContent, PostResult, AccountMetrics,
  EngagementAction, AuthTokens, ProviderCredentials, BrowserOperation,
} from "../provider";
import { BaseProvider } from "./base";

export class XProvider extends BaseProvider {
  readonly platform: Platform = "x";
  readonly displayName = "X (Twitter)";
  readonly icon = "𝕏";
  readonly maxPostLength = 280;
  readonly supportsMedia = true;
  readonly supportsScheduling = true;
  readonly supportedModes: OperationMode[] = ["hybrid", "api", "browser"];
  readonly authConfig: AuthConfig = {
    primary: "oauth",
    fallback: "session",
    oauthScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  };

  private clientId: string;
  private clientSecret: string;

  constructor(clientId?: string, clientSecret?: string) {
    super();
    this.clientId = clientId || process.env.X_CLIENT_ID || "";
    this.clientSecret = clientSecret || process.env.X_CLIENT_SECRET || "";
  }

  // --- OAuth 2.0 PKCE ---
  async getAuthUrl(redirectUri: string): Promise<string> {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: this.authConfig.oauthScopes!.join(" "),
      state: crypto.randomUUID(),
      code_challenge: "challenge",
      code_challenge_method: "plain",
    });
    return `https://twitter.com/i/oauth2/authorize?${params}`;
  }

  async handleCallback(code: string, redirectUri: string): Promise<AuthTokens> {
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: "challenge" }),
    });
    if (!res.ok) throw new Error(`X OAuth error: ${res.status}`);
    const d = (await res.json() as any);
    return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: new Date(Date.now() + d.expires_in * 1000), scope: d.scope };
  }

  async refreshToken(rt: string): Promise<AuthTokens> {
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ refresh_token: rt, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new Error(`X token refresh error: ${res.status}`);
    const d = (await res.json() as any);
    return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: new Date(Date.now() + d.expires_in * 1000) };
  }

  // --- API Mode ---
  async postViaApi(content: PostContent, cred: ProviderCredentials): Promise<PostResult> {
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: content.text }),
    });
    if (!res.ok) return { success: false, error: `API ${res.status}`, platform: "x", mode: "api" };
    const d = (await res.json() as any);
    return { success: true, postId: d.data?.id, url: `https://x.com/i/status/${d.data?.id}`, platform: "x", mode: "api" };
  }

  async getMetricsViaApi(cred: ProviderCredentials): Promise<AccountMetrics> {
    const res = await fetch("https://api.twitter.com/2/users/me?user.fields=public_metrics", {
      headers: { Authorization: `Bearer ${cred.accessToken}` },
    });
    if (!res.ok) throw new Error(`X metrics: ${res.status}`);
    const m = ((await res.json() as any)).data?.public_metrics || {};
    return { followers: m.followers_count || 0, following: m.following_count || 0, posts: m.tweet_count || 0, engagement: 0 };
  }

  async engageViaApi(action: EngagementAction, cred: ProviderCredentials): Promise<boolean> {
    const headers = { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json" };
    const tweetId = action.targetUrl.split("/").pop();
    if (!tweetId) return false;
    const meRes = await fetch("https://api.twitter.com/2/users/me", { headers });
    if (!meRes.ok) return false;
    const userId = ((await meRes.json() as any)).data?.id;
    if (!userId) return false;
    const endpoints: Record<string, string> = {
      like: `https://api.twitter.com/2/users/${userId}/likes`,
      repost: `https://api.twitter.com/2/users/${userId}/retweets`,
      bookmark: `https://api.twitter.com/2/users/${userId}/bookmarks`,
    };
    if (action.type === "reply") {
      const r = await fetch("https://api.twitter.com/2/tweets", { method: "POST", headers, body: JSON.stringify({ text: action.content || "", reply: { in_reply_to_tweet_id: tweetId } }) });
      return r.ok;
    }
    const ep = endpoints[action.type];
    if (!ep) return false;
    const r = await fetch(ep, { method: "POST", headers, body: JSON.stringify({ tweet_id: tweetId }) });
    return r.ok;
  }

  // --- Browser Mode ---
  getLoginSteps(): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://x.com/i/flow/login", waitFor: 'input[autocomplete="username"]', timeout: 15000 },
      { action: "login", url: "https://x.com/home", selectors: { username: 'input[autocomplete="username"]', password: 'input[type="password"]', submit: '[data-testid="LoginForm_Login_Button"]' }, inputData: {}, waitFor: '[data-testid="SideNav_NewTweet_Button"]' },
    ];
  }

  getPostSteps(content: PostContent): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://x.com/compose/post", waitFor: '[data-testid="tweetTextarea_0"]' },
      { action: "post", url: "https://x.com/compose/post", selectors: { editor: '[data-testid="tweetTextarea_0"]', submit: '[data-testid="tweetButton"]' }, inputData: { text: content.text } },
    ];
  }

  getMetricsSteps(): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://x.com/home", waitFor: '[data-testid="SideNav_AccountSwitcher_Button"]' },
      { action: "collect_metrics", url: "https://x.com/home", selectors: { followers: '[href$="/followers"] span', following: '[href$="/following"] span' } },
    ];
  }

  getSearchSteps(query: string): BrowserOperation[] {
    return [
      { action: "navigate", url: `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query`, waitFor: '[data-testid="tweet"]' },
      { action: "read", url: `https://x.com/search?q=${encodeURIComponent(query)}`, selectors: { tweets: '[data-testid="tweet"]' } },
    ];
  }
}
