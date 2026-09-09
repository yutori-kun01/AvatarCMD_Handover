// ================================================
// Avatar CMD — Analytics API
// ================================================

import { NextResponse } from "next/server";

export async function GET() {
  const analytics = {
    kpis: [
      { label: "総フォロワー", value: 80400, previousValue: 76200, change: 5.5, trend: "up" },
      { label: "今週のインプレッション", value: 245800, previousValue: 198300, change: 24.0, trend: "up" },
      { label: "エンゲージメント率", value: 4.7, previousValue: 4.2, change: 11.9, trend: "up" },
      { label: "月間収益", value: 847000, previousValue: 780000, change: 8.6, trend: "up" },
    ],
    avatarPerformance: [
      { avatarId: "1", name: "Haru", followers: 12400, engRate: 4.7, revenue: 182000, topPlatform: "x", weeklyPosts: 38 },
      { avatarId: "2", name: "Kai", followers: 8700, engRate: 5.2, revenue: 256000, topPlatform: "zenn", weeklyPosts: 24 },
      { avatarId: "3", name: "Mio", followers: 23100, engRate: 6.1, revenue: 198000, topPlatform: "instagram", weeklyPosts: 15 },
      { avatarId: "4", name: "Ren", followers: 31200, engRate: 3.8, revenue: 124000, topPlatform: "x", weeklyPosts: 52 },
      { avatarId: "5", name: "Sora", followers: 5600, engRate: 7.3, revenue: 87000, topPlatform: "note", weeklyPosts: 3 },
    ],
    improvement: {
      pendingCycles: 3,
      activeSuggestions: 7,
      appliedThisWeek: 4,
      suggestions: [
        { id: "s1", avatarId: "1", type: "timing", title: "投稿時間の最適化", impact: "high", description: "19-21時のゴールデンタイムに集中投稿" },
        { id: "s2", avatarId: "3", type: "content_style", title: "リール動画の増加", impact: "high", description: "静止画よりリール形式の方がリーチが2.3倍" },
        { id: "s3", avatarId: "4", type: "hashtags", title: "ニッチタグ活用", impact: "medium", description: "競合の少ないハッシュタグで上位表示を狙う" },
      ],
    },
    trends: {
      followers: Array.from({ length: 30 }, (_, i) => ({ date: `2026-02-${String(20 + Math.floor(i / 3)).padStart(2, "0")}`, value: 72000 + i * 280 + Math.floor(Math.random() * 500) })),
      engagement: Array.from({ length: 30 }, (_, i) => ({ date: `2026-02-${String(20 + Math.floor(i / 3)).padStart(2, "0")}`, value: 3.8 + Math.random() * 2 })),
    },
  };
  return NextResponse.json(analytics);
}
