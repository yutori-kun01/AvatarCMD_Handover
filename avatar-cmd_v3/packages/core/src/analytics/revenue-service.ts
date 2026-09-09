// ================================================
// @avatar-cmd/core — Revenue Service
// ================================================
// Multi-source revenue tracking per avatar.

import { randomUUID } from "crypto";

export type RevenueSource = "affiliate" | "paid_content" | "donation" | "sponsorship" | "ad_revenue" | "subscription" | "merchandise";

export interface RevenueEntry {
  id: string;
  avatarId: string;
  source: RevenueSource;
  platform: string;
  amount: number;
  currency: string;
  contentId?: string;
  campaignId?: string;
  description: string;
  earnedAt: Date;
  createdAt: Date;
}

export interface RevenueReport {
  totalRevenue: number;
  currency: string;
  byAvatar: { avatarId: string; total: number }[];
  bySource: { source: RevenueSource; total: number }[];
  byPlatform: { platform: string; total: number }[];
  monthly: { month: string; total: number }[];
  topContent: { contentId: string; revenue: number }[];
}

export class RevenueService {
  private entries: RevenueEntry[] = [];

  record(input: Omit<RevenueEntry, "id" | "createdAt">): RevenueEntry {
    const entry: RevenueEntry = { id: randomUUID(), ...input, createdAt: new Date() };
    this.entries.push(entry);
    return entry;
  }

  getReport(currency: string = "JPY"): RevenueReport {
    const data = this.entries.filter(e => e.currency === currency);
    const total = data.reduce((s, e) => s + e.amount, 0);

    // By avatar
    const avatarMap = new Map<string, number>();
    data.forEach(e => avatarMap.set(e.avatarId, (avatarMap.get(e.avatarId) || 0) + e.amount));
    const byAvatar = Array.from(avatarMap.entries()).map(([avatarId, total]) => ({ avatarId, total })).sort((a, b) => b.total - a.total);

    // By source
    const sourceMap = new Map<RevenueSource, number>();
    data.forEach(e => sourceMap.set(e.source, (sourceMap.get(e.source) || 0) + e.amount));
    const bySource = Array.from(sourceMap.entries()).map(([source, total]) => ({ source, total })).sort((a, b) => b.total - a.total);

    // By platform
    const platformMap = new Map<string, number>();
    data.forEach(e => platformMap.set(e.platform, (platformMap.get(e.platform) || 0) + e.amount));
    const byPlatform = Array.from(platformMap.entries()).map(([platform, total]) => ({ platform, total })).sort((a, b) => b.total - a.total);

    // Monthly
    const monthMap = new Map<string, number>();
    data.forEach(e => {
      const m = e.earnedAt.toISOString().slice(0, 7);
      monthMap.set(m, (monthMap.get(m) || 0) + e.amount);
    });
    const monthly = Array.from(monthMap.entries()).map(([month, total]) => ({ month, total })).sort((a, b) => a.month.localeCompare(b.month));

    // Top content
    const contentMap = new Map<string, number>();
    data.filter(e => e.contentId).forEach(e => contentMap.set(e.contentId!, (contentMap.get(e.contentId!) || 0) + e.amount));
    const topContent = Array.from(contentMap.entries()).map(([contentId, revenue]) => ({ contentId, revenue })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    return { totalRevenue: total, currency, byAvatar, bySource, byPlatform, monthly, topContent };
  }

  getByAvatar(avatarId: string): RevenueEntry[] { return this.entries.filter(e => e.avatarId === avatarId); }
  getByPlatform(platform: string): RevenueEntry[] { return this.entries.filter(e => e.platform === platform); }
  getTotal(avatarId?: string): number {
    const data = avatarId ? this.entries.filter(e => e.avatarId === avatarId) : this.entries;
    return data.reduce((s, e) => s + e.amount, 0);
  }
}
