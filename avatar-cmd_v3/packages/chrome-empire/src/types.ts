// ================================================
// @avatar-cmd/chrome-empire — Type Definitions
// ================================================

import type { Browser, BrowserContext, Page } from "playwright";

// --- Chrome Profile ---
export interface ChromeProfile {
  id: string;
  avatarId: string;
  userAgent: string;
  viewport: { width: number; height: number };
  proxy?: { server: string; username?: string; password?: string };
  storageDir: string;
  fingerprint: {
    timezone: string;
    locale: string;
    platform: string;
    colorDepth: number;
    hardwareConcurrency: number;
  };
}

// --- Chrome Instance ---
export interface ChromeInstance {
  id: string;
  avatarId: string;
  status: "idle" | "running" | "error" | "stopped";
  browser: Browser;
  context: BrowserContext;
  profile: ChromeProfile;
  metrics: InstanceMetrics;
  createdAt: Date;
  lastActivity: Date;
}

export interface InstanceMetrics {
  memoryMB: number;
  activePages: number;
  tasksCompleted: number;
  tasksErrored: number;
  uptime: number; // seconds
}

// --- Pool Status ---
export interface PoolStatus {
  totalInstances: number;
  activeInstances: number;
  idleInstances: number;
  errorInstances: number;
  totalMemoryMB: number;
  instances: {
    id: string;
    avatarId: string;
    status: string;
    metrics: InstanceMetrics;
  }[];
}

// --- Browser Tasks ---
export type TaskType =
  | "navigate"
  | "post"
  | "engage"
  | "scrape"
  | "screenshot"
  | "login"
  | "custom";

export interface BrowserTask {
  type: TaskType;
  avatarId: string;
  url?: string;
  payload?: Record<string, unknown>;
  timeout?: number; // ms
}

export interface TaskResult {
  success: boolean;
  taskType: TaskType;
  avatarId: string;
  data?: unknown;
  screenshot?: string; // base64
  error?: string;
  duration: number; // ms
}

// --- Events ---
export type PoolEvent =
  | { type: "instance:spawned"; avatarId: string; instanceId: string }
  | { type: "instance:destroyed"; avatarId: string; instanceId: string }
  | { type: "instance:error"; avatarId: string; error: string }
  | { type: "instance:recovered"; avatarId: string }
  | { type: "task:started"; avatarId: string; taskType: TaskType }
  | { type: "task:completed"; avatarId: string; taskType: TaskType; duration: number }
  | { type: "task:failed"; avatarId: string; taskType: TaskType; error: string }
  | { type: "pool:maxReached"; current: number; max: number };

export type PoolEventListener = (event: PoolEvent) => void;

// --- Config ---
export interface ChromeEmpireConfig {
  maxInstances: number;
  storageBaseDir: string;
  headless: boolean;
  defaultTimeout: number; // ms
  healthCheckInterval: number; // ms
  maxMemoryPerInstanceMB: number;
  recycleAfterTasks: number;
  stealthMode: boolean;
}

export const DEFAULT_CONFIG: ChromeEmpireConfig = {
  maxInstances: 5,
  storageBaseDir: "./chrome-data",
  headless: true,
  defaultTimeout: 30_000,
  healthCheckInterval: 60_000,
  maxMemoryPerInstanceMB: 512,
  recycleAfterTasks: 100,
  stealthMode: true,
};

// --- Provider step (mirror of @avatar-cmd/integrations BrowserOperation) ---
export interface BrowserStep {
  action: "login" | "post" | "read" | "engage" | "collect_metrics" | "search" | "navigate";
  url: string;
  selectors?: Record<string, string>;
  inputData?: Record<string, string>;
  waitFor?: string;
  timeout?: number;
}
