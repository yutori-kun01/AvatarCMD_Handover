// ================================================
// Avatar CMD — SNS Platforms API Route (v2)
// ================================================
// GET: Returns all platforms with operation modes

import { NextResponse } from "next/server";

// Platform spec matching packages/integrations
const platforms = [
  // --- Hybrid: API + Browser ---
  { platform: "x", displayName: "X (Twitter)", icon: "𝕏", authType: "oauth", modes: ["hybrid", "api", "browser"], maxPostLength: 280, supportsMedia: true, status: "available" },
  { platform: "threads", displayName: "Threads", icon: "🧵", authType: "oauth", modes: ["hybrid", "api", "browser"], maxPostLength: 500, supportsMedia: true, status: "available" },
  { platform: "instagram", displayName: "Instagram", icon: "📸", authType: "oauth", modes: ["hybrid", "api", "browser"], maxPostLength: 2200, supportsMedia: true, status: "available" },
  { platform: "youtube", displayName: "YouTube", icon: "▶️", authType: "oauth", modes: ["hybrid", "api", "browser"], maxPostLength: 5000, supportsMedia: true, status: "available" },
  { platform: "facebook", displayName: "Facebook", icon: "📘", authType: "oauth", modes: ["hybrid", "api", "browser"], maxPostLength: 63206, supportsMedia: true, status: "available" },
  { platform: "linkedin", displayName: "LinkedIn", icon: "💼", authType: "oauth", modes: ["hybrid", "api", "browser"], maxPostLength: 3000, supportsMedia: true, status: "available" },
  { platform: "reddit", displayName: "Reddit", icon: "🟠", authType: "oauth", modes: ["hybrid", "api", "browser"], maxPostLength: 40000, supportsMedia: true, status: "available" },

  // --- API Primary ---
  { platform: "bluesky", displayName: "Bluesky", icon: "🦋", authType: "app_password", modes: ["api", "browser"], maxPostLength: 300, supportsMedia: true, status: "available" },
  { platform: "wordpress", displayName: "WordPress", icon: "🔵", authType: "api_key", modes: ["api", "browser"], maxPostLength: 1000000, supportsMedia: true, status: "available" },

  // --- Browser Only ---
  { platform: "note", displayName: "note", icon: "📝", authType: "session", modes: ["browser"], maxPostLength: 140000, supportsMedia: true, status: "available" },
  { platform: "tiktok", displayName: "TikTok", icon: "🎵", authType: "session", modes: ["browser"], maxPostLength: 2200, supportsMedia: true, status: "available" },
  { platform: "zenn", displayName: "Zenn", icon: "📘", authType: "session", modes: ["browser"], maxPostLength: 100000, supportsMedia: true, status: "available" },
  { platform: "medium", displayName: "Medium", icon: "📰", authType: "session", modes: ["browser"], maxPostLength: 100000, supportsMedia: true, status: "available" },
  { platform: "substack", displayName: "Substack", icon: "📧", authType: "session", modes: ["browser"], maxPostLength: 500000, supportsMedia: true, status: "available" },
  { platform: "ameba", displayName: "Amebaブログ", icon: "🟢", authType: "session", modes: ["browser"], maxPostLength: 100000, supportsMedia: true, status: "available" },
  { platform: "standfm", displayName: "stand.fm", icon: "🎙️", authType: "session", modes: ["browser"], maxPostLength: 2000, supportsMedia: true, status: "available" },
];

export async function GET() {
  return NextResponse.json({
    totalPlatforms: platforms.length,
    hybridCount: platforms.filter(p => p.modes.includes("hybrid")).length,
    apiCount: platforms.filter(p => p.modes.includes("api")).length,
    browserCount: platforms.filter(p => p.modes.includes("browser")).length,
    platforms,
  });
}
