import { describe, it, expect } from "vitest";
import { isRuleDue, intervalMs } from "../src/scheduler/automation-runner";

const base = { triggerType: "schedule", createdAt: new Date("2026-01-01T00:00:00Z") };

describe("automation schedule", () => {
  it("parses interval configs incl. legacy v2 triggers", () => {
    expect(intervalMs({ intervalMinutes: 5 })).toBe(300_000);
    expect(intervalMs({ intervalSeconds: 30 })).toBe(30_000);
    expect(intervalMs({ legacy: "schedule:every_10min" })).toBe(600_000);
    expect(intervalMs({ legacy: "schedule:demo_15sec" })).toBe(15_000);
    expect(intervalMs({})).toBeNull();
  });

  it("is due when never run or when interval elapsed", () => {
    const now = new Date("2026-01-01T01:00:00Z");
    expect(isRuleDue({ ...base, triggerConfig: { intervalMinutes: 60 }, lastExecutedAt: null }, now)).toBe(true);
    expect(isRuleDue({ ...base, triggerConfig: { intervalMinutes: 60 }, lastExecutedAt: new Date("2026-01-01T00:30:00Z") }, now)).toBe(false);
    expect(isRuleDue({ ...base, triggerConfig: { intervalMinutes: 30 }, lastExecutedAt: new Date("2026-01-01T00:30:00Z") }, now)).toBe(true);
  });

  it("supports cron expressions", () => {
    const cfg = { cron: "0 * * * *" };
    expect(isRuleDue({ ...base, triggerConfig: cfg, lastExecutedAt: new Date("2026-01-01T00:10:00Z") }, new Date("2026-01-01T00:59:00Z"))).toBe(false);
    expect(isRuleDue({ ...base, triggerConfig: cfg, lastExecutedAt: new Date("2026-01-01T00:10:00Z") }, new Date("2026-01-01T01:00:01Z"))).toBe(true);
  });

  it("ignores non-schedule triggers", () => {
    expect(isRuleDue({ ...base, triggerType: "event", triggerConfig: { intervalSeconds: 1 }, lastExecutedAt: null }, new Date())).toBe(false);
  });
});
