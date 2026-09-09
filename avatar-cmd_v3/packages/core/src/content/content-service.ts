// ================================================
// @avatar-cmd/core — Content Service
// ================================================
// Manages content lifecycle: creation, scheduling,
// publishing queue. LLM-ready but no LLM dependency.

import { randomUUID } from "crypto";

// --- Types ---
export type ContentStatus = "draft" | "scheduled" | "queued" | "publishing" | "published" | "failed";
export type ContentCategory = "viral" | "educational" | "promotion" | "engagement" | "trend" | "collab" | "evergreen";

export interface ContentItem {
  id: string;
  avatarId: string;
  campaignId?: string;
  platform: string;
  content: string;
  category: ContentCategory;
  status: ContentStatus;
  media?: { type: string; url: string; alt?: string }[];
  tags?: string[];
  metadata: Record<string, unknown>;
  // Spark Engine
  sparkTriggered: boolean;
  sparkType?: string;
  moodAtCreation?: number;
  // A/B Testing
  variantGroup?: string;
  variantLabel?: string;
  // Results
  publishedAt?: Date;
  engagement?: { likes: number; comments: number; shares: number; views: number };
  // Scheduling
  scheduledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentCreateInput {
  avatarId: string;
  platform: string;
  content: string;
  category?: ContentCategory;
  campaignId?: string;
  media?: { type: string; url: string; alt?: string }[];
  tags?: string[];
  scheduledAt?: Date;
  variantGroup?: string;
  variantLabel?: string;
  metadata?: Record<string, unknown>;
}

// --- Content Service ---
export class ContentService {
  private items: Map<string, ContentItem> = new Map();
  private queue: string[] = []; // IDs in publishing order

  /**
   * Create new content
   */
  create(input: ContentCreateInput): ContentItem {
    const item: ContentItem = {
      id: randomUUID(),
      avatarId: input.avatarId,
      campaignId: input.campaignId,
      platform: input.platform,
      content: input.content,
      category: input.category || "viral",
      status: input.scheduledAt ? "scheduled" : "draft",
      media: input.media,
      tags: input.tags,
      metadata: input.metadata || {},
      sparkTriggered: false,
      variantGroup: input.variantGroup,
      variantLabel: input.variantLabel,
      scheduledAt: input.scheduledAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.items.set(item.id, item);
    return item;
  }

  /**
   * Create A/B test variants
   */
  createVariants(base: ContentCreateInput, variants: string[]): ContentItem[] {
    const group = randomUUID().slice(0, 8);
    return variants.map((text, i) =>
      this.create({
        ...base,
        content: text,
        variantGroup: group,
        variantLabel: String.fromCharCode(65 + i), // A, B, C...
      })
    );
  }

  /**
   * Queue content for publishing
   */
  enqueue(contentId: string): boolean {
    const item = this.items.get(contentId);
    if (!item || item.status === "published") return false;
    item.status = "queued";
    item.updatedAt = new Date();
    this.queue.push(contentId);
    return true;
  }

  /**
   * Dequeue next item for publishing
   */
  dequeue(): ContentItem | undefined {
    while (this.queue.length > 0) {
      const id = this.queue.shift()!;
      const item = this.items.get(id);
      if (item && item.status === "queued") {
        item.status = "publishing";
        item.updatedAt = new Date();
        return item;
      }
    }
    return undefined;
  }

  /**
   * Mark as published
   */
  markPublished(contentId: string, postUrl?: string): void {
    const item = this.items.get(contentId);
    if (!item) return;
    item.status = "published";
    item.publishedAt = new Date();
    item.updatedAt = new Date();
    if (postUrl) item.metadata.postUrl = postUrl;
  }

  /**
   * Mark as failed
   */
  markFailed(contentId: string, error: string): void {
    const item = this.items.get(contentId);
    if (!item) return;
    item.status = "failed";
    item.metadata.lastError = error;
    item.updatedAt = new Date();
  }

  /**
   * Update engagement metrics
   */
  updateEngagement(contentId: string, engagement: ContentItem["engagement"]): void {
    const item = this.items.get(contentId);
    if (!item) return;
    item.engagement = engagement;
    item.updatedAt = new Date();
  }

  /**
   * Get content due for scheduled publishing
   */
  getDueContent(): ContentItem[] {
    const now = new Date();
    return Array.from(this.items.values()).filter(
      (i) => i.status === "scheduled" && i.scheduledAt && i.scheduledAt <= now
    );
  }

  // --- Queries ---
  getById(id: string): ContentItem | undefined { return this.items.get(id); }
  getByAvatar(avatarId: string): ContentItem[] { return Array.from(this.items.values()).filter(i => i.avatarId === avatarId); }
  getByCampaign(campaignId: string): ContentItem[] { return Array.from(this.items.values()).filter(i => i.campaignId === campaignId); }
  getByStatus(status: ContentStatus): ContentItem[] { return Array.from(this.items.values()).filter(i => i.status === status); }
  getQueueSize(): number { return this.queue.length; }

  getStats(): { total: number; byStatus: Record<string, number>; byPlatform: Record<string, number>; queueSize: number } {
    const all = Array.from(this.items.values());
    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    for (const item of all) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
    }
    return { total: all.length, byStatus, byPlatform, queueSize: this.queue.length };
  }
}
