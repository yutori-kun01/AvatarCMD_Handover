// ================================================
// Avatar CMD — Content & Campaigns API
// ================================================

import { NextResponse } from "next/server";

export async function GET() {
  // Mock data for dashboard — will connect to ContentService via worker
  const contentStats = {
    total: 847,
    byStatus: { draft: 12, scheduled: 8, queued: 3, published: 812, failed: 12 },
    byPlatform: { x: 342, note: 156, threads: 98, youtube: 67, instagram: 84, tiktok: 45, zenn: 32, linkedin: 23 },
    queueSize: 3,
    recent: [
      { id: "c1", avatarId: "1", platform: "x", content: "ADHD当事者の朝ルーティン...", status: "published", engagement: { likes: 234, comments: 45, shares: 67, views: 12400 }, publishedAt: "2026-03-21T09:00:00Z" },
      { id: "c2", avatarId: "2", platform: "zenn", content: "AIでアプリを作る方法...", status: "published", engagement: { likes: 189, comments: 23, shares: 34, views: 8700 }, publishedAt: "2026-03-21T10:30:00Z" },
      { id: "c3", avatarId: "4", platform: "x", content: "AI最新ニュースまとめ...", status: "scheduled", scheduledAt: "2026-03-21T19:00:00Z" },
    ],
    campaigns: {
      total: 12,
      active: 4,
      completed: 7,
      draft: 1,
      activeCampaigns: [
        { id: "camp1", avatarId: "1", title: "ADHD啓発ウィーク", type: "organic", platforms: ["x", "note", "threads"], contentCount: 15, progress: 68 },
        { id: "camp2", avatarId: "2", title: "AIツール紹介シリーズ", type: "monetize", platforms: ["x", "zenn", "youtube"], contentCount: 8, progress: 45 },
        { id: "camp3", avatarId: "4", title: "トレンドハイジャック Q1", type: "trend_hijack", platforms: ["x", "tiktok"], contentCount: 24, progress: 82 },
        { id: "camp4", avatarId: "3", title: "マインドフルネス30日チャレンジ", type: "organic", platforms: ["instagram", "note"], contentCount: 30, progress: 53 },
      ],
    },
  };
  return NextResponse.json(contentStats);
}
