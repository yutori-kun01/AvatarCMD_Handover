import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRunAfter, validateAction, validateTrigger } from "../src/service/automation";
import { buildPrompts, readPersona } from "../src/service/ai";

test("daily: Asia/Tokyo の 09:00 / 19:00 の次回時刻", () => {
  const t = validateTrigger({ type: "daily", times: ["19:00", "09:00"], timezone: "Asia/Tokyo" });
  // 2026-09-27 08:00 JST = 2026-09-26T23:00Z → 同日 09:00 JST = 00:00Z
  assert.equal(nextRunAfter(t, new Date("2026-09-26T23:00:00Z")).toISOString(), "2026-09-27T00:00:00.000Z");
  // 09:00 JST ちょうど → 次は 19:00 JST = 10:00Z
  assert.equal(nextRunAfter(t, new Date("2026-09-27T00:00:00Z")).toISOString(), "2026-09-27T10:00:00.000Z");
  // 20:00 JST → 翌日 09:00 JST
  assert.equal(nextRunAfter(t, new Date("2026-09-27T11:00:00Z")).toISOString(), "2026-09-28T00:00:00.000Z");
});

test("daily: 夏時間のあるタイムゾーンでも壁時計どおり", () => {
  const t = validateTrigger({ type: "daily", times: ["09:00"], timezone: "America/New_York" });
  // 2026-11-01 に夏時間終了（EDT -4 → EST -5）
  assert.equal(nextRunAfter(t, new Date("2026-10-31T14:00:00Z")).toISOString(), "2026-11-01T14:00:00.000Z");
  assert.equal(nextRunAfter(t, new Date("2026-10-30T12:00:00Z")).toISOString(), "2026-10-30T13:00:00.000Z");
});

test("interval と入力検証", () => {
  assert.equal(nextRunAfter(validateTrigger({ type: "interval", hours: 6 }), new Date("2026-01-01T00:00:00Z")).toISOString(), "2026-01-01T06:00:00.000Z");
  assert.throws(() => validateTrigger({ type: "daily", times: ["25:00"] }), /時刻/);
  assert.throws(() => validateTrigger({ type: "interval", hours: 0 }), /間隔/);
  assert.throws(() => validateAction({ accountIds: [], topics: ["a"], mode: "auto" }), /アカウント/);
  assert.equal(validateAction({ accountIds: ["x"], topics: [" a ", ""], mode: "bogus" as any }).mode, "draft");
});

test("プロンプト: ペルソナ・文字数制限が入る", () => {
  const persona = readPersona({ tone: "やさしい", topics: ["ADHD"], prompt: "医療的な断定はしない" });
  const { system, user, limit } = buildPrompts(
    { name: "Haru", role: "ADHD当事者", description: null, specialization: null, targetAudience: "20代" },
    persona,
    { topic: "朝のルーティン", platform: "x" },
    [{ title: "睡眠", summary: null }]
  );
  assert.equal(limit, 280);
  assert.match(system, /Haru/);
  assert.match(system, /医療的な断定はしない/);
  assert.match(system, /睡眠/);
  assert.match(user, /280文字以内/);
  const long = buildPrompts({ name: "K", role: "", description: null, specialization: null, targetAudience: null }, {}, { topic: "t", platform: "zenn" }, []);
  assert.equal(long.limit, undefined);
  assert.match(long.user, /Markdown/);
});
