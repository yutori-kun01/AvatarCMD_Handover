// ================================================
// @avatar-cmd/core — Analytics Service
// ================================================
// KPI tracking, trend analysis, and data aggregation.

import { randomUUID } from "crypto";

export interface DailyMetrics {
  id: string;
  avatarId: string;
  platform: string;
  date: string; // YYYY-MM-DD
  followers: number;
  following: number;
  posts: number;
  impressions: number;
  engagements: number;
  engagementRate: number;
  clicks: number;
  revenue: number;
}

export interface KPI {
  label: string;
  value: number;
  previousValue: number;
  change: number; // percentage
  trend: "up" | "down" | "flat";
}

export interface AvatarInsight {
  avatarId: string;
  period: string;
  topPlatform: string;
  bestPostingTime: string;
  avgEngagementRate: number;
  followerGrowthRate: number;
  revenueGrowth: number;
  recommendations: string[];
}

export class AnalyticsService {
  private metrics: DailyMetrics[] = [];

  /**
   * Record daily metrics snapshot
   */
  record(input: Omit<DailyMetrics, "id">): DailyMetrics {
    const m: DailyMetrics = { id: randomUUID(), ...input };
    this.metrics.push(m);
    return m;
  }

  /**
   * Get KPIs for an avatar
   */
  getKPIs(avatarId: string): KPI[] {
    const data = this.metrics.filter(m => m.avatarId === avatarId);
    if (data.length === 0) return [];

    const latest = data.slice(-7); // Last 7 days
    const previous = data.slice(-14, -7); // Previous 7 days

    const sum = (arr: DailyMetrics[], key: keyof DailyMetrics) =>
      arr.reduce((s, m) => s + (Number(m[key]) || 0), 0);
    const avg = (arr: DailyMetrics[], key: keyof DailyMetrics) =>
      arr.length ? sum(arr, key) / arr.length : 0;

    const makeKPI = (label: string, key: keyof DailyMetrics, aggregate: "sum" | "avg" = "sum"): KPI => {
      const fn = aggregate === "sum" ? sum : avg;
      const current = fn(latest, key);
      const prev = fn(previous, key);
      const change = prev ? ((current - prev) / prev) * 100 : 0;
      return { label, value: current, previousValue: prev, change: Math.round(change * 10) / 10, trend: change > 1 ? "up" : change < -1 ? "down" : "flat" };
    };

    return [
      makeKPI("フォロワー", "followers", "avg"),
      makeKPI("インプレッション", "impressions"),
      makeKPI("エンゲージメント", "engagements"),
      makeKPI("エンゲージメント率", "engagementRate", "avg"),
      makeKPI("クリック", "clicks"),
      makeKPI("収益", "revenue"),
    ];
  }

  /**
   * Generate insights for an avatar
   */
  generateInsights(avatarId: string): AvatarInsight {
    const data = this.metrics.filter(m => m.avatarId === avatarId);
    const platforms = [...new Set(data.map(m => m.platform))];

    // Find best platform by engagement
    const platformEngagement = platforms.map(p => ({
      platform: p,
      avgEng: data.filter(m => m.platform === p).reduce((s, m) => s + m.engagementRate, 0) / (data.filter(m => m.platform === p).length || 1),
    }));
    const topPlatform = platformEngagement.sort((a, b) => b.avgEng - a.avgEng)[0]?.platform || "unknown";

    const avgEngRate = data.length ? data.reduce((s, m) => s + m.engagementRate, 0) / data.length : 0;
    const latestFollowers = data[data.length - 1]?.followers || 0;
    const firstFollowers = data[0]?.followers || 0;
    const followerGrowth = firstFollowers ? ((latestFollowers - firstFollowers) / firstFollowers) * 100 : 0;

    const recommendations: string[] = [];
    if (avgEngRate < 2) recommendations.push("エンゲージメント率が低めです。質問形式の投稿を増やしてみてください。");
    if (followerGrowth < 5) recommendations.push("フォロワー成長率を上げるため、ハッシュタグ戦略を見直してください。");
    if (platforms.length < 3) recommendations.push("プラットフォームを増やしてリーチを拡大しましょう。");

    return {
      avatarId,
      period: "7d",
      topPlatform,
      bestPostingTime: "19:00-21:00 JST",
      avgEngagementRate: Math.round(avgEngRate * 100) / 100,
      followerGrowthRate: Math.round(followerGrowth * 10) / 10,
      revenueGrowth: 0,
      recommendations,
    };
  }

  /**
   * Get trend data for charts
   */
  getTrend(avatarId: string, metric: keyof DailyMetrics, days: number = 30): { date: string; value: number }[] {
    return this.metrics
      .filter(m => m.avatarId === avatarId)
      .slice(-days)
      .map(m => ({ date: m.date, value: Number(m[metric]) || 0 }));
  }

  // Queries
  getByAvatar(avatarId: string): DailyMetrics[] { return this.metrics.filter(m => m.avatarId === avatarId); }
  getByPlatform(platform: string): DailyMetrics[] { return this.metrics.filter(m => m.platform === platform); }
  getLatest(avatarId: string): DailyMetrics | undefined {
    return this.metrics.filter(m => m.avatarId === avatarId).pop();
  }
}
