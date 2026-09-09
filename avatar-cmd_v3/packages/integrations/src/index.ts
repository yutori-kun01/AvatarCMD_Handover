// ================================================
// @avatar-cmd/integrations — Public API
// ================================================

// --- Core ---
export { ProviderRegistry } from "./registry";
export { BaseProvider } from "./providers/base";

// --- Providers ---
export { XProvider } from "./providers/x";
export { NoteProvider } from "./providers/note";
export {
  ThreadsProvider,
  InstagramProvider,
  YouTubeProvider,
  TikTokProvider,
  ZennProvider,
  BlueskyProvider,
  FacebookProvider,
  WordPressProvider,
  LinkedInProvider,
  RedditProvider,
  MediumProvider,
  SubstackProvider,
  AmebaProvider,
  StandfmProvider,
} from "./providers/platforms";

// --- Types ---
export {
  type Platform,
  type OperationMode,
  type AuthType,
  type AuthConfig,
  type SnsProvider,
  type PostContent,
  type PostResult,
  type AccountMetrics,
  type EngagementAction,
  type AuthTokens,
  type ProviderCredentials,
  type BrowserOperation,
  type RateLimitConfig,
  type RateLimitState,
} from "./provider";

// --- Factory ---
import { ProviderRegistry } from "./registry";
import { XProvider } from "./providers/x";
import { NoteProvider } from "./providers/note";
import {
  ThreadsProvider, InstagramProvider, YouTubeProvider,
  TikTokProvider, ZennProvider, BlueskyProvider,
  FacebookProvider, WordPressProvider, LinkedInProvider,
  RedditProvider, MediumProvider, SubstackProvider,
  AmebaProvider, StandfmProvider,
} from "./providers/platforms";

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  // API + Browser (Hybrid)
  registry.register(new XProvider());
  registry.register(new ThreadsProvider());
  registry.register(new InstagramProvider());
  registry.register(new YouTubeProvider());
  registry.register(new FacebookProvider());
  registry.register(new LinkedInProvider());
  registry.register(new RedditProvider());

  // API Primary
  registry.register(new BlueskyProvider());
  registry.register(new WordPressProvider());

  // Browser Only
  registry.register(new NoteProvider());
  registry.register(new TikTokProvider());
  registry.register(new ZennProvider());
  registry.register(new MediumProvider());
  registry.register(new SubstackProvider());
  registry.register(new AmebaProvider());
  registry.register(new StandfmProvider());

  return registry;
}
