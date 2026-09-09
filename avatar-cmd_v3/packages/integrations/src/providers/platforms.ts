// ================================================
// All remaining platform providers
// Dual-mode: API + Browser as applicable
// ================================================

import type { Platform, OperationMode, AuthConfig, PostContent, BrowserOperation, ProviderCredentials, AuthTokens, PostResult, AccountMetrics, EngagementAction } from "../provider";
import { BaseProvider } from "./base";

// ============================================
// Threads — Hybrid (Meta API + Browser)
// ============================================
export class ThreadsProvider extends BaseProvider {
  readonly platform: Platform = "threads";
  readonly displayName = "Threads";
  readonly icon = "🧵";
  readonly maxPostLength = 500;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["hybrid", "api", "browser"];
  readonly authConfig: AuthConfig = { primary: "oauth", fallback: "session", oauthScopes: ["threads_basic", "threads_content_publish"] };

  async getAuthUrl(redirectUri: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: process.env.THREADS_APP_ID || "",
      redirect_uri: redirectUri,
      scope: "threads_basic,threads_content_publish,threads_manage_replies",
      response_type: "code",
    });
    return `https://threads.net/oauth/authorize?${params}`;
  }

  async postViaApi(content: PostContent, cred: ProviderCredentials): Promise<PostResult> {
    // Threads Publishing API: 2-step (create container → publish)
    const createRes = await fetch(`https://graph.threads.net/v1.0/me/threads?text=${encodeURIComponent(content.text)}&media_type=TEXT&access_token=${cred.accessToken}`, { method: "POST" });
    if (!createRes.ok) return { success: false, error: `Threads create: ${createRes.status}`, platform: "threads", mode: "api" };
    const { id: containerId } = await createRes.json();
    const publishRes = await fetch(`https://graph.threads.net/v1.0/me/threads_publish?creation_id=${containerId}&access_token=${cred.accessToken}`, { method: "POST" });
    if (!publishRes.ok) return { success: false, error: `Threads publish: ${publishRes.status}`, platform: "threads", mode: "api" };
    const d = await publishRes.json();
    return { success: true, postId: d.id, platform: "threads", mode: "api" };
  }

  getLoginSteps(): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://www.threads.net/login", waitFor: 'input[name="username"]' },
      { action: "login", url: "https://www.threads.net/login", selectors: { username: 'input[name="username"]', password: 'input[name="password"]', submit: 'button[type="submit"]' }, inputData: {} },
    ];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://www.threads.net", waitFor: '[role="textbox"]' },
      { action: "post", url: "https://www.threads.net", selectors: { editor: '[role="textbox"]', submit: 'div[role="button"]:has-text("Post")' }, inputData: { text: content.text } },
    ];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://www.threads.net/search?q=${encodeURIComponent(query)}`, waitFor: "article" }, { action: "read", url: `https://www.threads.net/search?q=${encodeURIComponent(query)}`, selectors: { items: "article" } }];
  }
}

// ============================================
// Instagram — Hybrid (Graph API + Browser)
// ============================================
export class InstagramProvider extends BaseProvider {
  readonly platform: Platform = "instagram";
  readonly displayName = "Instagram";
  readonly icon = "📸";
  readonly maxPostLength = 2200;
  readonly supportsMedia = true;
  readonly supportsScheduling = true;
  readonly supportedModes: OperationMode[] = ["hybrid", "api", "browser"];
  readonly authConfig: AuthConfig = { primary: "oauth", fallback: "session", oauthScopes: ["instagram_basic", "instagram_content_publish"] };

  getLoginSteps(): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://www.instagram.com/accounts/login/", waitFor: 'input[name="username"]' },
      { action: "login", url: "https://www.instagram.com/accounts/login/", selectors: { username: 'input[name="username"]', password: 'input[name="password"]', submit: 'button[type="submit"]' }, inputData: {} },
    ];
  }
  getMetricsSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.instagram.com/accounts/edit/", waitFor: "header section" }, { action: "collect_metrics", url: "https://www.instagram.com", selectors: { followers: 'header section ul li:nth-child(2) span', posts: 'header section ul li:nth-child(1) span' } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`, waitFor: "article" }, { action: "read", url: `https://www.instagram.com/explore/search`, selectors: { items: "article" } }];
  }
}

// ============================================
// YouTube — Hybrid (Data API v3 + Browser)
// ============================================
export class YouTubeProvider extends BaseProvider {
  readonly platform: Platform = "youtube";
  readonly displayName = "YouTube";
  readonly icon = "▶️";
  readonly maxPostLength = 5000;
  readonly supportsMedia = true;
  readonly supportsScheduling = true;
  readonly supportedModes: OperationMode[] = ["hybrid", "api", "browser"];
  readonly authConfig: AuthConfig = { primary: "oauth", oauthScopes: ["https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.upload"] };

  async getMetricsViaApi(cred: ProviderCredentials): Promise<AccountMetrics> {
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", { headers: { Authorization: `Bearer ${cred.accessToken}` } });
    if (!res.ok) throw new Error(`YouTube metrics: ${res.status}`);
    const ch = (await res.json()).items?.[0]?.statistics || {};
    return { followers: parseInt(ch.subscriberCount || "0"), following: 0, posts: parseInt(ch.videoCount || "0"), engagement: 0, impressions: parseInt(ch.viewCount || "0") };
  }

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://accounts.google.com/signin", waitFor: 'input[type="email"]' }, { action: "login", url: "https://accounts.google.com/signin", selectors: { email: 'input[type="email"]', password: 'input[type="password"]' }, inputData: {} }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, waitFor: "ytd-video-renderer" }, { action: "read", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, selectors: { items: "ytd-video-renderer" } }];
  }
}

// ============================================
// TikTok — Browser Only (API制限多い)
// ============================================
export class TikTokProvider extends BaseProvider {
  readonly platform: Platform = "tiktok";
  readonly displayName = "TikTok";
  readonly icon = "🎵";
  readonly maxPostLength = 2200;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["browser"];
  readonly authConfig: AuthConfig = { primary: "session", requiresBrowser: true };

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.tiktok.com/login", waitFor: '[data-e2e="login-form"]' }, { action: "login", url: "https://www.tiktok.com/login/phone-or-email/email", selectors: { email: 'input[name="username"]', password: 'input[type="password"]', submit: 'button[type="submit"]' }, inputData: {} }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`, waitFor: '[data-e2e="search_top-item-list"]' }, { action: "read", url: `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`, selectors: { items: '[data-e2e="search-card-user-link"]' } }];
  }
  getMetricsSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.tiktok.com/analytics", waitFor: ".analytics" }, { action: "collect_metrics", url: "https://www.tiktok.com/analytics", selectors: { followers: '[data-e2e="followers-count"]', likes: '[data-e2e="likes-count"]' } }];
  }
}

// ============================================
// Zenn — Browser Only (no public API)
// ============================================
export class ZennProvider extends BaseProvider {
  readonly platform: Platform = "zenn";
  readonly displayName = "Zenn";
  readonly icon = "📘";
  readonly maxPostLength = 100_000;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["browser"];
  readonly authConfig: AuthConfig = { primary: "session", requiresBrowser: true };

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://zenn.dev/enter", waitFor: 'a[href*="google"]' }];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [{ action: "navigate", url: "https://zenn.dev/articles/new", waitFor: '[contenteditable="true"]' }, { action: "post", url: "https://zenn.dev/articles/new", selectors: { editor: '[contenteditable="true"]', title: 'input[name="title"]' }, inputData: { text: content.text } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://zenn.dev/search?q=${encodeURIComponent(query)}`, waitFor: "article" }, { action: "read", url: `https://zenn.dev/search?q=${encodeURIComponent(query)}`, selectors: { items: "article" } }];
  }
}

// ============================================
// Bluesky — API (AT Protocol)
// ============================================
export class BlueskyProvider extends BaseProvider {
  readonly platform: Platform = "bluesky";
  readonly displayName = "Bluesky";
  readonly icon = "🦋";
  readonly maxPostLength = 300;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["api", "browser"];
  readonly authConfig: AuthConfig = { primary: "app_password" };

  async postViaApi(content: PostContent, cred: ProviderCredentials): Promise<PostResult> {
    const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: cred.apiKey, collection: "app.bsky.feed.post", record: { text: content.text, createdAt: new Date().toISOString(), $type: "app.bsky.feed.post" } }),
    });
    if (!res.ok) return { success: false, error: `Bluesky: ${res.status}`, platform: "bluesky", mode: "api" };
    const d = await res.json();
    return { success: true, postId: d.uri, platform: "bluesky", mode: "api" };
  }

  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://bsky.app/search?q=${encodeURIComponent(query)}`, waitFor: '[data-testid="postFeedItem"]' }, { action: "read", url: `https://bsky.app/search?q=${encodeURIComponent(query)}`, selectors: { items: '[data-testid="postFeedItem"]' } }];
  }
}

// ============================================
// Facebook — Hybrid (Graph API + Browser)
// ============================================
export class FacebookProvider extends BaseProvider {
  readonly platform: Platform = "facebook";
  readonly displayName = "Facebook";
  readonly icon = "📘";
  readonly maxPostLength = 63206;
  readonly supportsMedia = true;
  readonly supportsScheduling = true;
  readonly supportedModes: OperationMode[] = ["hybrid", "api", "browser"];
  readonly authConfig: AuthConfig = { primary: "oauth", fallback: "session", oauthScopes: ["pages_manage_posts", "pages_read_engagement"] };

  async postViaApi(content: PostContent, cred: ProviderCredentials): Promise<PostResult> {
    const pageId = (cred as any).pageId || "me";
    const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content.text, access_token: cred.accessToken }),
    });
    if (!res.ok) return { success: false, error: `FB: ${res.status}`, platform: "facebook", mode: "api" };
    const d = await res.json();
    return { success: true, postId: d.id, platform: "facebook", mode: "api" };
  }

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.facebook.com/login", waitFor: '#email' }, { action: "login", url: "https://www.facebook.com/login", selectors: { email: '#email', password: '#pass', submit: 'button[name="login"]' }, inputData: {} }];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.facebook.com", waitFor: '[role="textbox"]' }, { action: "post", url: "https://www.facebook.com", selectors: { editor: '[role="textbox"]', submit: '[aria-label="Post"]' }, inputData: { text: content.text } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://www.facebook.com/search/posts?q=${encodeURIComponent(query)}`, waitFor: '[role="article"]' }, { action: "read", url: `https://www.facebook.com/search/posts?q=${encodeURIComponent(query)}`, selectors: { items: '[role="article"]' } }];
  }
}

// ============================================
// WordPress — API (REST API v2)
// ============================================
export class WordPressProvider extends BaseProvider {
  readonly platform: Platform = "wordpress";
  readonly displayName = "WordPress";
  readonly icon = "🔵";
  readonly maxPostLength = 1_000_000;
  readonly supportsMedia = true;
  readonly supportsScheduling = true;
  readonly supportedModes: OperationMode[] = ["api", "browser"];
  readonly authConfig: AuthConfig = { primary: "api_key" }; // Application Password

  async postViaApi(content: PostContent, cred: ProviderCredentials): Promise<PostResult> {
    const siteUrl = (cred as any).siteUrl || "";
    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${cred.apiKey}`).toString("base64")}` },
      body: JSON.stringify({ title: content.metadata?.title || content.text.slice(0, 60), content: content.text, status: content.scheduleAt ? "future" : "publish", date: content.scheduleAt?.toISOString() }),
    });
    if (!res.ok) return { success: false, error: `WP: ${res.status}`, platform: "wordpress", mode: "api" };
    const d = await res.json();
    return { success: true, postId: String(d.id), url: d.link, platform: "wordpress", mode: "api" };
  }

  async getMetricsViaApi(cred: ProviderCredentials): Promise<AccountMetrics> {
    const siteUrl = (cred as any).siteUrl || "";
    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts?per_page=1`, { headers: { Authorization: `Basic ${Buffer.from(`${cred.apiKey}`).toString("base64")}` } });
    const total = parseInt(res.headers.get("X-WP-Total") || "0");
    return { followers: 0, following: 0, posts: total, engagement: 0 };
  }
}

// ============================================
// LinkedIn — Hybrid (API + Browser)
// ============================================
export class LinkedInProvider extends BaseProvider {
  readonly platform: Platform = "linkedin";
  readonly displayName = "LinkedIn";
  readonly icon = "💼";
  readonly maxPostLength = 3000;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["hybrid", "api", "browser"];
  readonly authConfig: AuthConfig = { primary: "oauth", fallback: "session", oauthScopes: ["w_member_social", "r_basicprofile"] };

  async postViaApi(content: PostContent, cred: ProviderCredentials): Promise<PostResult> {
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify({ author: `urn:li:person:${(cred as any).personId}`, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: content.text }, shareMediaCategory: "NONE" } }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } }),
    });
    if (!res.ok) return { success: false, error: `LinkedIn: ${res.status}`, platform: "linkedin", mode: "api" };
    const d = await res.json();
    return { success: true, postId: d.id, platform: "linkedin", mode: "api" };
  }

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.linkedin.com/login", waitFor: '#username' }, { action: "login", url: "https://www.linkedin.com/login", selectors: { email: '#username', password: '#password', submit: 'button[type="submit"]' }, inputData: {} }];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.linkedin.com/feed/", waitFor: '.share-box-feed-entry__trigger' }, { action: "post", url: "https://www.linkedin.com/feed/", selectors: { trigger: '.share-box-feed-entry__trigger', editor: '[role="textbox"]', submit: 'button.share-actions__primary-action' }, inputData: { text: content.text } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`, waitFor: '.update-components-text' }, { action: "read", url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`, selectors: { items: '.update-components-text' } }];
  }
}

// ============================================
// Reddit — Hybrid (API + Browser)
// ============================================
export class RedditProvider extends BaseProvider {
  readonly platform: Platform = "reddit";
  readonly displayName = "Reddit";
  readonly icon = "🟠";
  readonly maxPostLength = 40_000;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["hybrid", "api", "browser"];
  readonly authConfig: AuthConfig = { primary: "oauth", fallback: "session", oauthScopes: ["submit", "read", "identity"] };

  async postViaApi(content: PostContent, cred: ProviderCredentials): Promise<PostResult> {
    const subreddit = (content.metadata?.subreddit as string) || "test";
    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ kind: "self", sr: subreddit, title: (content.metadata?.title as string) || content.text.slice(0, 100), text: content.text }),
    });
    if (!res.ok) return { success: false, error: `Reddit: ${res.status}`, platform: "reddit", mode: "api" };
    const d = await res.json();
    return { success: true, postId: d.json?.data?.name, url: d.json?.data?.url, platform: "reddit", mode: "api" };
  }

  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`, waitFor: 'faceplate-batch' }, { action: "read", url: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`, selectors: { items: 'faceplate-batch article' } }];
  }
}

// ============================================
// Medium — Browser Only
// ============================================
export class MediumProvider extends BaseProvider {
  readonly platform: Platform = "medium";
  readonly displayName = "Medium";
  readonly icon = "📰";
  readonly maxPostLength = 100_000;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["browser"];
  readonly authConfig: AuthConfig = { primary: "session", requiresBrowser: true };

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://medium.com/m/signin", waitFor: 'a[href*="google"]' }];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [{ action: "navigate", url: "https://medium.com/new-story", waitFor: '[role="textbox"]' }, { action: "post", url: "https://medium.com/new-story", selectors: { title: 'h3[data-contents="true"]', body: '[role="textbox"]' }, inputData: { text: content.text } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://medium.com/search?q=${encodeURIComponent(query)}`, waitFor: "article" }, { action: "read", url: `https://medium.com/search?q=${encodeURIComponent(query)}`, selectors: { items: "article" } }];
  }
}

// ============================================
// Substack — Browser Only
// ============================================
export class SubstackProvider extends BaseProvider {
  readonly platform: Platform = "substack";
  readonly displayName = "Substack";
  readonly icon = "📧";
  readonly maxPostLength = 500_000;
  readonly supportsMedia = true;
  readonly supportsScheduling = true;
  readonly supportedModes: OperationMode[] = ["browser"];
  readonly authConfig: AuthConfig = { primary: "session", requiresBrowser: true };

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://substack.com/sign-in", waitFor: 'input[type="email"]' }, { action: "login", url: "https://substack.com/sign-in", selectors: { email: 'input[type="email"]' }, inputData: {} }];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [{ action: "navigate", url: "https://substack.com/publish/post", waitFor: '[contenteditable="true"]' }, { action: "post", url: "https://substack.com/publish/post", selectors: { title: 'input[placeholder*="Title"]', body: '[contenteditable="true"]' }, inputData: { text: content.text } }];
  }
}

// ============================================
// Amebaブログ — Browser Only
// ============================================
export class AmebaProvider extends BaseProvider {
  readonly platform: Platform = "ameba";
  readonly displayName = "Amebaブログ";
  readonly icon = "🟢";
  readonly maxPostLength = 100_000;
  readonly supportsMedia = true;
  readonly supportsScheduling = true;
  readonly supportedModes: OperationMode[] = ["browser"];
  readonly authConfig: AuthConfig = { primary: "session", requiresBrowser: true };

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://www.ameba.jp/login", waitFor: '#ameba_id' }, { action: "login", url: "https://www.ameba.jp/login", selectors: { id: '#ameba_id', password: '#password', submit: 'button[type="submit"]' }, inputData: {} }];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [{ action: "navigate", url: "https://blog.ameba.jp/ucs/entry/srventryinsertinput.do", waitFor: '#editor' }, { action: "post", url: "https://blog.ameba.jp/ucs/entry/srventryinsertinput.do", selectors: { title: '#entryTitle', editor: '#editor' }, inputData: { text: content.text } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://search.ameba.jp/search?q=${encodeURIComponent(query)}`, waitFor: ".searchResult" }, { action: "read", url: `https://search.ameba.jp/search?q=${encodeURIComponent(query)}`, selectors: { items: ".searchResult li" } }];
  }
}

// ============================================
// stand.fm — Browser Only
// ============================================
export class StandfmProvider extends BaseProvider {
  readonly platform: Platform = "standfm";
  readonly displayName = "stand.fm";
  readonly icon = "🎙️";
  readonly maxPostLength = 2000;
  readonly supportsMedia = true; // audio
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["browser"];
  readonly authConfig: AuthConfig = { primary: "session", requiresBrowser: true };

  getLoginSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://stand.fm/login", waitFor: 'input[type="email"]' }, { action: "login", url: "https://stand.fm/login", selectors: { email: 'input[type="email"]', password: 'input[type="password"]', submit: 'button[type="submit"]' }, inputData: {} }];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [{ action: "navigate", url: "https://stand.fm/episodes/new", waitFor: 'input[name="title"]' }, { action: "post", url: "https://stand.fm/episodes/new", selectors: { title: 'input[name="title"]', description: 'textarea[name="description"]' }, inputData: { text: content.text } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://stand.fm/search?q=${encodeURIComponent(query)}`, waitFor: ".channel-card" }, { action: "read", url: `https://stand.fm/search?q=${encodeURIComponent(query)}`, selectors: { items: ".channel-card" } }];
  }
}
