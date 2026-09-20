// @avatar-cmd/core — Public API
export { MoodEngine } from "./persona/mood-engine";
export { AvatarService } from "./avatar/avatar-service";
export { authorizeJob, JobAccessError } from "./security/job-access";
export { CredentialVault } from "./security/credential-vault";

// Phase 3: Content & Campaigns
export {
  ContentService,
  type ContentItem,
  type ContentCreateInput,
  type ContentStatus,
  type ContentCategory,
} from "./content/content-service";
export {
  CampaignService,
  type Campaign,
  type CampaignCreateInput,
  type CampaignStatus,
  type CampaignType,
} from "./content/campaign-service";

// Phase 4: Analytics & Improvement
export {
  AnalyticsService,
  type DailyMetrics,
  type KPI,
  type AvatarInsight,
} from "./analytics/analytics-service";
export {
  ImprovementEngine,
  type ImprovementCycle,
  type ImprovementSuggestion,
  type ImprovementStatus,
} from "./analytics/improvement-engine";

// Phase 5: Revenue
export {
  RevenueService,
  type RevenueEntry,
  type RevenueReport,
  type RevenueSource,
} from "./analytics/revenue-service";

// Phase 6: Scheduler
export {
  SchedulerService,
  type ScheduledJob,
  type SchedulerStats,
  type ScheduleFrequency,
} from "./scheduler/scheduler-service";

// Phase 7: AI & Soul Engine (from V2 integration)
export * from "./ai/router";
export * from "./persona/soul-engine";

// Phase 7: Orchestrator & Workers (from V2 integration)
export {
  orchestrator,
  type Job,
  type JobType,
  type JobPayload,
} from "./scheduler/orchestrator";
export { processJob } from "./scheduler/workers";
export {
  runSchedulerTick,
  validateCron,
  type TickResult,
} from "./scheduler/tick";

// Security: SSRF guard
export {
  assertPublicUrl,
  safeFetch,
  isBlockedAddress,
  SsrfBlockedError,
} from "./security/url-guard";
