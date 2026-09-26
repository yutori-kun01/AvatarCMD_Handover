// ================================================
// @avatar-cmd/chrome-empire — Chrome Empire Pool
// ================================================
// Core pool manager: spawns, manages, and monitors
// Playwright browser instances per avatar.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { ProfileManager } from "./profile";
import {
  type ChromeEmpireConfig,
  type ChromeInstance,
  type ChromeProfile,
  type PoolStatus,
  type BrowserTask,
  type TaskResult,
  type PoolEvent,
  type PoolEventListener,
  type BrowserStep,
  DEFAULT_CONFIG,
} from "./types";

export class ChromeEmpire {
  private config: ChromeEmpireConfig;
  private instances: Map<string, ChromeInstance> = new Map();
  private profileManager: ProfileManager;
  private listeners: PoolEventListener[] = [];
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<ChromeEmpireConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.profileManager = new ProfileManager(this.config.storageBaseDir);
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Start the pool and begin health monitoring
   */
  async start(): Promise<void> {
    console.log("[ChromeEmpire] Starting pool...");
    this.healthTimer = setInterval(
      () => this.healthCheck(),
      this.config.healthCheckInterval
    );
    console.log(
      `[ChromeEmpire] Pool started. Max instances: ${this.config.maxInstances}`
    );
  }

  /**
   * Shutdown all instances and stop monitoring
   */
  async shutdown(): Promise<void> {
    console.log("[ChromeEmpire] Shutting down...");
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    const promises = Array.from(this.instances.keys()).map((avatarId) =>
      this.destroyInstance(avatarId)
    );
    await Promise.allSettled(promises);
    console.log("[ChromeEmpire] Shutdown complete.");
  }

  // ============================================
  // Instance Management
  // ============================================

  /**
   * Spawn a new browser instance for an avatar
   */
  async spawnForAvatar(avatarId: string): Promise<ChromeInstance> {
    // Check if already exists
    const existing = this.instances.get(avatarId);
    if (existing && existing.status !== "stopped") {
      return existing;
    }

    // Check pool limit
    const activeCount = this.getActiveCount();
    if (activeCount >= this.config.maxInstances) {
      this.emit({
        type: "pool:maxReached",
        current: activeCount,
        max: this.config.maxInstances,
      });
      throw new Error(
        `Pool limit reached (${activeCount}/${this.config.maxInstances})`
      );
    }

    const profile = this.profileManager.getOrCreate(avatarId);

    // Ensure storage dir exists
    if (!existsSync(profile.storageDir)) {
      mkdirSync(profile.storageDir, { recursive: true });
    }

    try {
      // Launch browser with persistent context (session persistence)
      const browser = await chromium.launch({
        headless: this.config.headless,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          `--window-size=${profile.viewport.width},${profile.viewport.height}`,
        ],
      });

      const context = await browser.newContext({
        userAgent: profile.userAgent,
        viewport: profile.viewport,
        locale: profile.fingerprint.locale,
        timezoneId: profile.fingerprint.timezone,
        ...(profile.proxy && { proxy: profile.proxy }),
        storageState: this.getStorageStatePath(profile),
      });

      // Apply stealth patches if enabled
      if (this.config.stealthMode) {
        await this.applyStealthPatches(context, profile);
      }

      const instance: ChromeInstance = {
        id: randomUUID(),
        avatarId,
        status: "idle",
        browser,
        context,
        profile,
        metrics: {
          memoryMB: 0,
          activePages: 0,
          tasksCompleted: 0,
          tasksErrored: 0,
          uptime: 0,
        },
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      this.instances.set(avatarId, instance);
      this.emit({
        type: "instance:spawned",
        avatarId,
        instanceId: instance.id,
      });

      console.log(`[ChromeEmpire] Spawned instance for avatar: ${avatarId}`);
      return instance;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emit({ type: "instance:error", avatarId, error: msg });
      throw error;
    }
  }

  /**
   * Destroy an avatar's browser instance
   */
  async destroyInstance(avatarId: string): Promise<void> {
    const instance = this.instances.get(avatarId);
    if (!instance) return;

    try {
      // Save session state before closing
      await this.saveSessionState(instance);
      await instance.context.close();
      await instance.browser.close();
    } catch {
      // Best-effort cleanup
    }

    instance.status = "stopped";
    this.instances.delete(avatarId);
    this.emit({
      type: "instance:destroyed",
      avatarId,
      instanceId: instance.id,
    });
    console.log(`[ChromeEmpire] Destroyed instance for avatar: ${avatarId}`);
  }

  // ============================================
  // Task Execution
  // ============================================

  /**
   * Execute a browser task for an avatar
   */
  async executeTask(task: BrowserTask): Promise<TaskResult> {
    const instance = this.instances.get(task.avatarId);
    if (!instance || instance.status === "stopped") {
      throw new Error(`No active instance for avatar: ${task.avatarId}`);
    }

    const startTime = Date.now();
    instance.status = "running";
    instance.lastActivity = new Date();
    this.emit({
      type: "task:started",
      avatarId: task.avatarId,
      taskType: task.type,
    });

    try {
      const page = await instance.context.newPage();
      const timeout = task.timeout || this.config.defaultTimeout;
      let data: unknown = null;

      switch (task.type) {
        case "navigate":
          if (task.url) {
            await page.goto(task.url, { timeout, waitUntil: "domcontentloaded" });
            data = { url: page.url(), title: await page.title() };
          }
          break;

        case "screenshot":
          if (task.url) {
            await page.goto(task.url, { timeout, waitUntil: "load" });
          }
          const buffer = await page.screenshot({ fullPage: true });
          data = { screenshot: buffer.toString("base64") };
          break;

        case "scrape":
          if (task.url) {
            await page.goto(task.url, { timeout, waitUntil: "domcontentloaded" });
          }
          const content = await page.content();
          data = { html: content, url: page.url() };
          break;

        case "post":
        case "engage":
        case "login":
        case "custom":
          // These require platform-specific implementations
          // which will be added in the tasks/ directory
          if (task.url) {
            await page.goto(task.url, { timeout, waitUntil: "domcontentloaded" });
          }
          data = { message: `Task type '${task.type}' executed. Implement platform-specific logic in tasks/.` };
          break;
      }

      await page.close();
      instance.status = "idle";
      instance.metrics.tasksCompleted++;

      const duration = Date.now() - startTime;
      this.emit({
        type: "task:completed",
        avatarId: task.avatarId,
        taskType: task.type,
        duration,
      });

      // Auto-recycle if needed
      if (instance.metrics.tasksCompleted >= this.config.recycleAfterTasks) {
        console.log(`[ChromeEmpire] Recycling instance for ${task.avatarId} after ${instance.metrics.tasksCompleted} tasks`);
        await this.destroyInstance(task.avatarId);
        await this.spawnForAvatar(task.avatarId);
      }

      return { success: true, taskType: task.type, avatarId: task.avatarId, data, duration };
    } catch (error) {
      instance.status = "error";
      instance.metrics.tasksErrored++;

      const msg = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;
      this.emit({
        type: "task:failed",
        avatarId: task.avatarId,
        taskType: task.type,
        error: msg,
      });

      return { success: false, taskType: task.type, avatarId: task.avatarId, error: msg, duration };
    }
  }

  /**
   * Execute a sequence of provider-defined BrowserOperation steps
   * (from @avatar-cmd/integrations getPostSteps etc.) in one page.
   * Relies on a persisted session (storageState) — login steps are not
   * automated and must be performed once manually for the profile.
   */
  async executeSteps(avatarId: string, steps: BrowserStep[]): Promise<TaskResult> {
    const instance = await this.spawnForAvatar(avatarId);
    const startTime = Date.now();
    instance.status = "running";
    instance.lastActivity = new Date();
    this.emit({ type: "task:started", avatarId, taskType: "custom" });
    const page = await instance.context.newPage();
    const collected: Record<string, string[]> = {};
    try {
      for (const step of steps) {
        const timeout = step.timeout ?? this.config.defaultTimeout;
        switch (step.action) {
          case "navigate":
            await page.goto(step.url, { timeout, waitUntil: "domcontentloaded" });
            if (step.waitFor) await page.waitForSelector(step.waitFor, { timeout });
            break;
          case "post": {
            const editor = step.selectors?.editor;
            const submit = step.selectors?.submit;
            const text = step.inputData?.text ?? "";
            if (!editor || !submit) throw new Error("post step requires editor and submit selectors");
            if (!page.url().startsWith(step.url)) await page.goto(step.url, { timeout, waitUntil: "domcontentloaded" });
            const el = page.locator(editor).first();
            await el.waitFor({ timeout });
            await el.click();
            await page.keyboard.type(text, { delay: 15 });
            await page.locator(submit).first().click({ timeout });
            await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
            break;
          }
          case "read":
          case "collect_metrics":
            for (const [key, sel] of Object.entries(step.selectors ?? {})) {
              collected[key] = await page.locator(sel).allInnerTexts();
            }
            break;
          case "login":
            // Credentials are never sent to the worker. A logged-in session
            // must already exist in the profile's storage state.
            if (step.waitFor && !(await page.locator(step.waitFor).count())) {
              throw new Error("Session expired: manual login required for this profile");
            }
            break;
          default:
            break;
        }
      }
      const url = page.url();
      await this.saveSessionState(instance);
      instance.status = "idle";
      instance.metrics.tasksCompleted++;
      const duration = Date.now() - startTime;
      this.emit({ type: "task:completed", avatarId, taskType: "custom", duration });
      return { success: true, taskType: "custom", avatarId, data: { url, collected }, duration };
    } catch (error) {
      instance.status = "error";
      instance.metrics.tasksErrored++;
      const msg = error instanceof Error ? error.message : String(error);
      this.emit({ type: "task:failed", avatarId, taskType: "custom", error: msg });
      return { success: false, taskType: "custom", avatarId, error: msg, duration: Date.now() - startTime };
    } finally {
      await page.close().catch(() => {});
      if (instance.status === "error") instance.status = "idle";
    }
  }

  // ============================================
  // Pool Status
  // ============================================

  /**
   * Get full pool status for dashboard display
   */
  getPoolStatus(): PoolStatus {
    const instances = Array.from(this.instances.values());
    return {
      totalInstances: instances.length,
      activeInstances: instances.filter((i) => i.status === "running").length,
      idleInstances: instances.filter((i) => i.status === "idle").length,
      errorInstances: instances.filter((i) => i.status === "error").length,
      totalMemoryMB: instances.reduce((sum, i) => sum + i.metrics.memoryMB, 0),
      instances: instances.map((i) => ({
        id: i.id,
        avatarId: i.avatarId,
        status: i.status,
        metrics: i.metrics,
      })),
    };
  }

  /**
   * Get an instance by avatar ID
   */
  getInstance(avatarId: string): ChromeInstance | undefined {
    return this.instances.get(avatarId);
  }

  // ============================================
  // Events
  // ============================================

  /**
   * Subscribe to pool events
   */
  on(listener: PoolEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ============================================
  // Private: Health Check
  // ============================================

  private async healthCheck(): Promise<void> {
    for (const [avatarId, instance] of this.instances) {
      try {
        // Check if browser is still connected
        if (!instance.browser.isConnected()) {
          console.log(`[ChromeEmpire] Instance ${avatarId} disconnected, recovering...`);
          instance.status = "error";
          this.emit({ type: "instance:error", avatarId, error: "Browser disconnected" });

          // Attempt recovery
          await this.destroyInstance(avatarId);
          await this.spawnForAvatar(avatarId);
          this.emit({ type: "instance:recovered", avatarId });
          continue;
        }

        // Update metrics
        const pages = instance.context.pages();
        instance.metrics.activePages = pages.length;
        instance.metrics.uptime = Math.floor(
          (Date.now() - instance.createdAt.getTime()) / 1000
        );
      } catch {
        instance.status = "error";
      }
    }
  }

  // ============================================
  // Private: Session Persistence
  // ============================================

  private async saveSessionState(instance: ChromeInstance): Promise<void> {
    try {
      const statePath = `${instance.profile.storageDir}/session-state.json`;
      const state = await instance.context.storageState();
      writeFileSync(statePath, JSON.stringify(state), "utf-8");
    } catch {
      // Best-effort save
    }
  }

  private getStorageStatePath(profile: ChromeProfile): string | undefined {
    const path = `${profile.storageDir}/session-state.json`;
    return existsSync(path) ? path : undefined;
  }

  // ============================================
  // Private: Stealth
  // ============================================

  private async applyStealthPatches(
    context: BrowserContext,
    profile: ChromeProfile
  ): Promise<void> {
    await context.addInitScript({
      content: `
        // Override navigator properties
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'platform', { get: () => '${profile.fingerprint.platform}' });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${profile.fingerprint.hardwareConcurrency} });
        Object.defineProperty(screen, 'colorDepth', { get: () => ${profile.fingerprint.colorDepth} });

        // Chrome runtime spoofing
        window.chrome = {
          runtime: {},
          loadTimes: () => {},
          csi: () => {},
          app: {}
        };

        // Permission spoofing
        const origQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery(parameters);

        // Plugin spoofing
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });

        // Language consistency
        Object.defineProperty(navigator, 'languages', {
          get: () => ['${profile.fingerprint.locale}', 'en']
        });
      `,
    });
  }

  // ============================================
  // Private: Utils
  // ============================================

  private getActiveCount(): number {
    return Array.from(this.instances.values()).filter(
      (i) => i.status !== "stopped"
    ).length;
  }

  private emit(event: PoolEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors crash the pool
      }
    }
  }
}
