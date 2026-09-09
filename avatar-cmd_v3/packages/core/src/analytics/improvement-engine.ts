// ================================================
// @avatar-cmd/core — Improvement Engine
// ================================================
// Self-improvement cycle: analyze → suggest → apply.

import { randomUUID } from "crypto";

export type ImprovementStatus = "pending" | "reviewed" | "applied" | "dismissed";
export type TriggerType = "scheduled" | "threshold" | "manual";

export interface ImprovementSuggestion {
  id: string;
  type: "timing" | "content_style" | "hashtags" | "platform_mix" | "engagement" | "persona_tune";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  confidence: number; // 0-1
  actionData?: Record<string, unknown>;
}

export interface ImprovementCycle {
  id: string;
  avatarId: string;
  triggerType: TriggerType;
  status: ImprovementStatus;
  analysis: {
    period: string;
    metrics: Record<string, number>;
    findings: string[];
  };
  suggestions: ImprovementSuggestion[];
  appliedSuggestions: string[]; // IDs
  impact?: {
    before: Record<string, number>;
    after: Record<string, number>;
    improvement: Record<string, number>;
  };
  createdAt: Date;
  updatedAt: Date;
}

export class ImprovementEngine {
  private cycles: Map<string, ImprovementCycle> = new Map();

  /**
   * Create a new improvement cycle from analytics data
   */
  createCycle(
    avatarId: string,
    triggerType: TriggerType,
    metrics: Record<string, number>
  ): ImprovementCycle {
    const suggestions = this.generateSuggestions(metrics);
    const findings = this.analyzeFindings(metrics);

    const cycle: ImprovementCycle = {
      id: randomUUID(),
      avatarId,
      triggerType,
      status: "pending",
      analysis: { period: "7d", metrics, findings },
      suggestions,
      appliedSuggestions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.cycles.set(cycle.id, cycle);
    return cycle;
  }

  /**
   * Apply a suggestion
   */
  applySuggestion(cycleId: string, suggestionId: string): boolean {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return false;
    const suggestion = cycle.suggestions.find(s => s.id === suggestionId);
    if (!suggestion) return false;
    cycle.appliedSuggestions.push(suggestionId);
    cycle.status = "applied";
    cycle.updatedAt = new Date();
    return true;
  }

  /**
   * Dismiss a cycle
   */
  dismiss(cycleId: string): boolean {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return false;
    cycle.status = "dismissed";
    cycle.updatedAt = new Date();
    return true;
  }

  /**
   * Record impact after applying suggestions
   */
  recordImpact(cycleId: string, before: Record<string, number>, after: Record<string, number>): void {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return;
    const improvement: Record<string, number> = {};
    for (const key of Object.keys(after)) {
      const b = before[key] || 0;
      const a = after[key] || 0;
      improvement[key] = b ? Math.round(((a - b) / b) * 100 * 10) / 10 : 0;
    }
    cycle.impact = { before, after, improvement };
    cycle.updatedAt = new Date();
  }

  // Queries
  getById(id: string): ImprovementCycle | undefined { return this.cycles.get(id); }
  getByAvatar(avatarId: string): ImprovementCycle[] { return Array.from(this.cycles.values()).filter(c => c.avatarId === avatarId); }
  getPending(): ImprovementCycle[] { return Array.from(this.cycles.values()).filter(c => c.status === "pending"); }

  // --- Private: Suggestion Generation ---
  private generateSuggestions(metrics: Record<string, number>): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    if ((metrics.engagementRate || 0) < 3) {
      suggestions.push({
        id: randomUUID(), type: "content_style", title: "コンテンツスタイルの改善",
        description: "エンゲージメント率が低めです。質問形式やストーリーテリング形式の投稿を増やすことで、読者の反応を促進できます。",
        impact: "high", confidence: 0.8,
        actionData: { adjustWritingRules: { questionFrequency: 0.3, storytelling: true } },
      });
    }

    if ((metrics.postFrequency || 0) < 3) {
      suggestions.push({
        id: randomUUID(), type: "timing", title: "投稿頻度の最適化",
        description: "投稿頻度を1日3-5件に増やすことで、インプレッションの向上が見込めます。",
        impact: "medium", confidence: 0.7,
        actionData: { targetFrequency: 4, optimalHours: [8, 12, 19, 21] },
      });
    }

    if ((metrics.hashtagReach || 0) < 1000) {
      suggestions.push({
        id: randomUUID(), type: "hashtags", title: "ハッシュタグ戦略の見直し",
        description: "トレンドハッシュタグとニッチハッシュタグのバランスを調整し、リーチを拡大しましょう。",
        impact: "medium", confidence: 0.6,
        actionData: { trendTags: 2, nicheTags: 3, brandTags: 1 },
      });
    }

    if (Object.keys(metrics).filter(k => k.startsWith("platform_")).length < 3) {
      suggestions.push({
        id: randomUUID(), type: "platform_mix", title: "プラットフォーム拡張",
        description: "活動プラットフォームを増やすことで、異なるオーディエンスへのリーチが可能になります。",
        impact: "high", confidence: 0.65,
      });
    }

    // Always suggest persona tuning
    suggestions.push({
      id: randomUUID(), type: "persona_tune", title: "ペルソナの微調整",
      description: "直近のパフォーマンスデータに基づき、トーンやテーマの比率を微調整します。",
      impact: "low", confidence: 0.5,
      actionData: { adjustMoodBaseline: true },
    });

    return suggestions;
  }

  private analyzeFindings(metrics: Record<string, number>): string[] {
    const findings: string[] = [];
    if ((metrics.engagementRate || 0) > 5) findings.push("エンゲージメント率が高水準を維持しています。");
    if ((metrics.followerGrowth || 0) > 10) findings.push("フォロワー成長率が好調です。");
    if ((metrics.engagementRate || 0) < 2) findings.push("エンゲージメント率の改善余地があります。");
    if ((metrics.revenue || 0) > 100000) findings.push("収益が目標を上回っています。");
    if (findings.length === 0) findings.push("現在のパフォーマンスは安定しています。");
    return findings;
  }
}
