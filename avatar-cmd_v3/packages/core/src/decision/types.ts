export type JevDecisionAction = "publish" | "review" | "hold";

export interface PostDecisionInput {
  avatarId: string;
  platform: string;
  content: string;
  topic?: string;
  soulContext: string;
  recentPosts?: string[];
  recentKnowledge?: string[];
}

export interface PostDecisionResult {
  available: boolean;
  mode: "shadow";
  model?: string;
  action?: JevDecisionAction;
  actionConfidence?: number;
  personaFitScore?: number;
  salesPressureScore?: number;
  duplicateRisk?: number;
  brandRiskScore?: number;
  durationMs: number;
  answers?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  skippedReason?: string;
  error?: string;
}
