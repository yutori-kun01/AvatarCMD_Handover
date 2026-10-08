// ================================================
// エディション（配布版で使えるプラットフォーム）
// ================================================
// 買い切りプラン向けの配布版では、安定して運用できている X / Threads / note だけを有効にし、
// それ以外のプラットフォームは画面に「準備中」と表示して接続・アプリ登録・投稿を受け付けない。
// 対応を広げるときは ENABLED_PLATFORMS に追加する（null にすると全プラットフォームが有効）。
import type { Platform } from "./types";
import { ConfigError } from "./http";

export const EDITION_NAME = "買い切りプラン";

export const ENABLED_PLATFORMS: readonly Platform[] | null = ["x", "threads", "note"];

export function isPlatformEnabled(platform: string): boolean {
  return !ENABLED_PLATFORMS || (ENABLED_PLATFORMS as readonly string[]).includes(platform);
}

/** 準備中のプラットフォームなら ConfigError を投げる */
export function assertPlatformEnabled(platform: string, name: string = platform): void {
  if (!isPlatformEnabled(platform)) throw new ConfigError(`${name} は準備中です（今後のアップデートで対応予定）`);
}
