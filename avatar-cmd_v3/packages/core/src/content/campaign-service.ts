// ================================================
// @avatar-cmd/core — Campaign Service
// ================================================
// Campaign lifecycle: plan → execute → analyze.
// Supports AI-generated campaigns and A/B testing.

import { randomUUID } from "crypto";

export type CampaignStatus = "draft" | "planning" | "active" | "paused" | "completed" | "archived";
export type CampaignType = "organic" | "collab" | "monetize" | "trend_hijack" | "evergreen" | "launch";

export interface Campaign {
  id: string;
  avatarId: string;
  title: string;
  description: string;
  type: CampaignType;
  status: CampaignStatus;
  platforms: string[];
  startDate?: Date;
  endDate?: Date;
  contentIds: string[];
  // AI
  aiGenerated: boolean;
  trendData?: Record<string, unknown>;
  // Goals
  goals: { metric: string; target: number; current: number }[];
  // Results
  metrics: { impressions: number; engagements: number; clicks: number; conversions: number; revenue: number };
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignCreateInput {
  avatarId: string;
  title: string;
  description?: string;
  type?: CampaignType;
  platforms?: string[];
  startDate?: Date;
  endDate?: Date;
  goals?: { metric: string; target: number }[];
}

export class CampaignService {
  private campaigns: Map<string, Campaign> = new Map();

  create(input: CampaignCreateInput): Campaign {
    const campaign: Campaign = {
      id: randomUUID(),
      avatarId: input.avatarId,
      title: input.title,
      description: input.description || "",
      type: input.type || "organic",
      status: "draft",
      platforms: input.platforms || [],
      startDate: input.startDate,
      endDate: input.endDate,
      contentIds: [],
      aiGenerated: false,
      goals: (input.goals || []).map(g => ({ ...g, current: 0 })),
      metrics: { impressions: 0, engagements: 0, clicks: 0, conversions: 0, revenue: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.campaigns.set(campaign.id, campaign);
    return campaign;
  }

  activate(id: string): boolean {
    const c = this.campaigns.get(id);
    if (!c) return false;
    c.status = "active";
    c.startDate = c.startDate || new Date();
    c.updatedAt = new Date();
    return true;
  }

  pause(id: string): boolean {
    const c = this.campaigns.get(id);
    if (!c) return false;
    c.status = "paused";
    c.updatedAt = new Date();
    return true;
  }

  complete(id: string): boolean {
    const c = this.campaigns.get(id);
    if (!c) return false;
    c.status = "completed";
    c.endDate = c.endDate || new Date();
    c.updatedAt = new Date();
    return true;
  }

  addContent(campaignId: string, contentId: string): boolean {
    const c = this.campaigns.get(campaignId);
    if (!c) return false;
    c.contentIds.push(contentId);
    c.updatedAt = new Date();
    return true;
  }

  updateMetrics(id: string, delta: Partial<Campaign["metrics"]>): void {
    const c = this.campaigns.get(id);
    if (!c) return;
    for (const [k, v] of Object.entries(delta)) {
      (c.metrics as any)[k] = ((c.metrics as any)[k] || 0) + (v || 0);
    }
    c.updatedAt = new Date();
  }

  updateGoalProgress(id: string, metric: string, value: number): void {
    const c = this.campaigns.get(id);
    if (!c) return;
    const goal = c.goals.find(g => g.metric === metric);
    if (goal) goal.current = value;
    c.updatedAt = new Date();
  }

  getById(id: string): Campaign | undefined { return this.campaigns.get(id); }
  getByAvatar(avatarId: string): Campaign[] { return Array.from(this.campaigns.values()).filter(c => c.avatarId === avatarId); }
  getActive(): Campaign[] { return Array.from(this.campaigns.values()).filter(c => c.status === "active"); }

  getStats(): { total: number; active: number; completed: number; totalRevenue: number } {
    const all = Array.from(this.campaigns.values());
    return {
      total: all.length,
      active: all.filter(c => c.status === "active").length,
      completed: all.filter(c => c.status === "completed").length,
      totalRevenue: all.reduce((s, c) => s + c.metrics.revenue, 0),
    };
  }
}
