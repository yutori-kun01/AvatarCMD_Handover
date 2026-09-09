// ================================================
// note.com — Browser Only (no public API)
// ================================================
import type { Platform, OperationMode, AuthConfig, PostContent, BrowserOperation, ProviderCredentials } from "../provider";
import { BaseProvider } from "./base";

export class NoteProvider extends BaseProvider {
  readonly platform: Platform = "note";
  readonly displayName = "note";
  readonly icon = "📝";
  readonly maxPostLength = 140_000;
  readonly supportsMedia = true;
  readonly supportsScheduling = false;
  readonly supportedModes: OperationMode[] = ["browser"];
  readonly authConfig: AuthConfig = { primary: "session", requiresBrowser: true };

  getLoginSteps(cred: ProviderCredentials): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://note.com/login", waitFor: 'input[name="login"]' },
      { action: "login", url: "https://note.com/login", selectors: { email: 'input[name="login"]', password: 'input[name="password"]', submit: 'button[type="submit"]' }, inputData: {} },
    ];
  }
  getPostSteps(content: PostContent): BrowserOperation[] {
    return [
      { action: "navigate", url: "https://note.com/new", waitFor: '[contenteditable="true"]' },
      { action: "post", url: "https://note.com/new", selectors: { editor: '[contenteditable="true"]', submit: 'button[data-action="publish"]' }, inputData: { text: content.text } },
    ];
  }
  getMetricsSteps(): BrowserOperation[] {
    return [{ action: "navigate", url: "https://note.com/dashboard", waitFor: ".stats" }, { action: "collect_metrics", url: "https://note.com/dashboard", selectors: { followers: ".follower-count", posts: ".note-count" } }];
  }
  getSearchSteps(query: string): BrowserOperation[] {
    return [{ action: "navigate", url: `https://note.com/search?q=${encodeURIComponent(query)}`, waitFor: ".note-item" }, { action: "read", url: `https://note.com/search?q=${encodeURIComponent(query)}`, selectors: { items: ".note-item" } }];
  }
}
