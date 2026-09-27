import type { Platform, PlatformDefinition } from "../types";
import { x } from "./x";
import { threads } from "./threads";
import { instagram } from "./instagram";
import { facebook } from "./facebook";
import { youtube } from "./youtube";
import { linkedin } from "./linkedin";
import { reddit } from "./reddit";
import { tiktok } from "./tiktok";
import { bluesky } from "./bluesky";
import { wordpress } from "./wordpress";
import { zenn } from "./zenn";
import { medium } from "./medium";
import { note } from "./note";
import { substack, ameba, standfm } from "./manual";

/** 表示順もこの順番 */
export const PLATFORM_LIST: PlatformDefinition[] = [
  x, threads, instagram, facebook, youtube, tiktok, linkedin, reddit,
  bluesky, wordpress, zenn, note, medium, substack, ameba, standfm,
];

export const PLATFORMS: Record<Platform, PlatformDefinition> = Object.fromEntries(
  PLATFORM_LIST.map((p) => [p.id, p])
) as Record<Platform, PlatformDefinition>;

export function getPlatform(id: string): PlatformDefinition | undefined {
  return (PLATFORMS as Record<string, PlatformDefinition>)[id];
}
