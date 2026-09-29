import { test } from "node:test";
import assert from "node:assert/strict";
import { autoApprovalDecision, nextRunAfter, validateAction, validateTrigger } from "../src/service/automation";
import { buildPrompts, readPersona, taskForPlatform } from "../src/service/ai";

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

test("自動承認: 自動投稿モードの approval は未指定なら all、下書きモードでは持たない", () => {
  assert.equal(validateAction({ accountIds: ["x"], topics: ["a"], mode: "auto" }).approval, "all");
  assert.equal(validateAction({ accountIds: ["x"], topics: ["a"], mode: "auto", approval: "strict" }).approval, "strict");
  assert.equal(validateAction({ accountIds: ["x"], topics: ["a"], mode: "auto", approval: "bogus" as any }).approval, "all");
  assert.equal(validateAction({ accountIds: ["x"], topics: ["a"], mode: "draft", approval: "strict" }).approval, undefined);
});

test("自動承認: 範囲ごとに投稿するか下書きに回すか", () => {
  const ok = { verdict: "ok", summary: "" };
  const caution = { verdict: "caution", summary: "表現が強い" };
  const ng = { verdict: "ng", summary: "断定表現" };
  const err = { verdict: "error", summary: "", error: "timeout" };
  const hold = { mode: "gate" as const, action: "hold", publish: false, reason: "Jev: 公開すべきでない（hold）" };
  const review = { mode: "gate" as const, action: "review", publish: false, reason: "Jev: 人の確認が必要（review）" };
  const shadowHold = { ...hold, mode: "shadow" as const };

  // all: 何があっても投稿（Jev の判定は反映しない）
  for (const r of [ok, caution, ng, err]) assert.deepEqual(autoApprovalDecision("all", r, hold), { publish: true, gateApplied: false });

  // standard: NG と Jev の hold だけ保留
  assert.equal(autoApprovalDecision("standard", caution).publish, true);
  assert.equal(autoApprovalDecision("standard", err).publish, true);
  assert.equal(autoApprovalDecision("standard", ok, review).publish, true);
  assert.deepEqual(autoApprovalDecision("standard", ng), { publish: false, reason: "断定表現", gateApplied: false });
  assert.deepEqual(autoApprovalDecision("standard", ok, hold), { publish: false, reason: hold.reason, gateApplied: true });
  assert.equal(autoApprovalDecision("standard", ok, shadowHold).publish, true);

  // strict: OK かつ Jev 通過のみ（従来の動作）
  assert.equal(autoApprovalDecision("strict", ok).publish, true);
  assert.equal(autoApprovalDecision("strict", caution).publish, false);
  assert.match(autoApprovalDecision("strict", err).reason!, /チェック失敗/);
  assert.deepEqual(autoApprovalDecision("strict", ok, review), { publish: false, reason: review.reason, gateApplied: true });
  assert.equal(autoApprovalDecision("strict", ok, shadowHold).publish, true);
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

test("AI の用途: 長文プラットフォームは記事、それ以外は SNS 投稿", () => {
  assert.equal(taskForPlatform("x"), "post");
  assert.equal(taskForPlatform(undefined), "post");
  assert.equal(taskForPlatform("zenn"), "article");
  assert.equal(taskForPlatform("wordpress"), "article");
});
