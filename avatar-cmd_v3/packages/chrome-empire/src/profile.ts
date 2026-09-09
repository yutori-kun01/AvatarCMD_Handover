// ================================================
// @avatar-cmd/chrome-empire — Profile Manager
// ================================================
// Manages browser profiles with fingerprint isolation.
// Each avatar gets a unique, persistent profile.

import { randomUUID } from "crypto";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import type { ChromeProfile } from "./types";

// --- User Agent Pool ---
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 },
];

const TIMEZONES = [
  "Asia/Tokyo",
  "Asia/Tokyo",
  "Asia/Tokyo",
  "America/New_York",
  "Europe/London",
];

const PLATFORMS = [
  "Win32",
  "MacIntel",
  "Linux x86_64",
];

export class ProfileManager {
  private baseDir: string;
  private profiles: Map<string, ChromeProfile> = new Map();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    this.loadProfiles();
  }

  /**
   * Get or create a profile for an avatar
   */
  getOrCreate(avatarId: string): ChromeProfile {
    const existing = this.profiles.get(avatarId);
    if (existing) return existing;

    const profile = this.generateProfile(avatarId);
    this.profiles.set(avatarId, profile);
    this.saveProfile(profile);
    return profile;
  }

  /**
   * Get a profile by avatar ID
   */
  get(avatarId: string): ChromeProfile | undefined {
    return this.profiles.get(avatarId);
  }

  /**
   * Delete a profile
   */
  delete(avatarId: string): boolean {
    return this.profiles.delete(avatarId);
  }

  /**
   * List all profiles
   */
  listAll(): ChromeProfile[] {
    return Array.from(this.profiles.values());
  }

  // --- Private ---

  private generateProfile(avatarId: string): ChromeProfile {
    // Deterministic-ish selection based on avatar ID hash
    const hash = this.hashCode(avatarId);
    const idx = Math.abs(hash);

    const storageDir = join(this.baseDir, `profile-${avatarId}`);
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    return {
      id: randomUUID(),
      avatarId,
      userAgent: USER_AGENTS[idx % USER_AGENTS.length],
      viewport: VIEWPORTS[idx % VIEWPORTS.length],
      storageDir,
      fingerprint: {
        timezone: TIMEZONES[idx % TIMEZONES.length],
        locale: "ja-JP",
        platform: PLATFORMS[idx % PLATFORMS.length],
        colorDepth: 24,
        hardwareConcurrency: [4, 8, 12, 16][idx % 4],
      },
    };
  }

  private saveProfile(profile: ChromeProfile): void {
    const file = join(profile.storageDir, "profile.json");
    writeFileSync(file, JSON.stringify(profile, null, 2), "utf-8");
  }

  private loadProfiles(): void {
    if (!existsSync(this.baseDir)) return;

    const { readdirSync, statSync } = require("fs") as typeof import("fs");
    const entries = readdirSync(this.baseDir);

    for (const entry of entries) {
      const dir = join(this.baseDir, entry);
      if (!statSync(dir).isDirectory()) continue;

      const file = join(dir, "profile.json");
      if (!existsSync(file)) continue;

      try {
        const data = JSON.parse(readFileSync(file, "utf-8")) as ChromeProfile;
        this.profiles.set(data.avatarId, data);
      } catch {
        // Skip corrupt profiles
      }
    }
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash;
  }
}
