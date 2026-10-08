// ================================================
// @avatar-cmd/integrations — Public API
// ================================================
// 各SNSの公式API仕様に沿った投稿連携と、ダッシュボードで入力した
// 認証情報（暗号化保存）を使って投稿するサービス層。

export * from "./types";
export { PLATFORM_LIST, PLATFORMS, getPlatform } from "./platforms";
export { EDITION_NAME, ENABLED_PLATFORMS, isPlatformEnabled, assertPlatformEnabled } from "./edition";
export { ApiError, ConfigError } from "./http";
export { markdownToHtml } from "./markdown";
