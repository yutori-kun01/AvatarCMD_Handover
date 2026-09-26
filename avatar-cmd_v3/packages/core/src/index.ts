// @avatar-cmd/core — Public API
export { MoodEngine, type MoodState, type SparkResult, type SparkType } from "./persona/mood-engine";
export { AvatarService } from "./avatar/avatar-service";
export { CredentialVault } from "./security/credential-vault";

// Phase 3: Content & Campaigns (in-memory domain services)
export { ContentService, type ContentItem, type ContentCreateInput, type ContentStatus, type ContentCategory } from "./content/content-service";
export { CampaignService, type Campaign, type CampaignCreateInput, type CampaignStatus, type CampaignType } from "./content/campaign-service";

// Phase 4: Analytics & Improvement
export { AnalyticsService, type DailyMetrics, type KPI, type AvatarInsight } from "./analytics/analytics-service";
export { ImprovementEngine, type ImprovementCycle, type ImprovementSuggestion, type ImprovementStatus } from "./analytics/improvement-engine";

// Phase 5: Revenue
export { RevenueService, type RevenueEntry, type RevenueReport, type RevenueSource } from "./analytics/revenue-service";

// Phase 6: Scheduler (in-memory job registry)
export { SchedulerService, type ScheduledJob, type SchedulerStats, type ScheduleFrequency } from "./scheduler/scheduler-service";

// Integration (v2 → v3): AI Router, Soul Engine, Queue, Automations, Publishing, Security
export * from "./ai/router";
export * from "./persona/soul-engine";
export { orchestrator, isValidJobType, JOB_TYPES, type Job, type JobType, type JobPayload, type QueueStatus } from "./scheduler/orchestrator";
export { processJob } from "./scheduler/workers";
export { startScheduler, stopScheduler, evaluateAutomations, enqueueDueScheduledPosts, isRuleDue, intervalMs, type ScheduleConfig } from "./scheduler/automation-runner";
export { publishContent, getPublishMode, type PublishOutcome, type PublishMode } from "./publishing/publisher";
export { dispatchBrowserTask, startBrowserResultListener, getChromeQueueCounts, getChromePoolStatus, CHROME_QUEUE, CHROME_STATUS_KEY, type BrowserDispatchPayload } from "./publishing/browser-dispatch";
export { safeFetch, assertSafeUrl, isBlockedIp, extractText, SsrfError } from "./security/ssrf-guard";
