import { test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch } from "./helpers";
import { AI_PROVIDERS, AI_TASKS, callProvider, type AiProvider } from "../src/service/llm";

const SCHEMA = { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"], additionalProperties: false };

/** Messages API のストリーミング応答（SSE） */
function claudeSse(model: string, text: string, stopReason = "end_turn") {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }),
    ev("message_stop", {}),
  ].join("");
}

test("用途ごとに全プロバイダの推奨モデルがある", () => {
  for (const [id, t] of Object.entries(AI_TASKS)) {
    for (const p of Object.keys(AI_PROVIDERS) as AiProvider[]) assert.ok(t.recommended[p], `${id}/${p}`);
  }
  // 長文記事は上位モデル、単純作業は軽量モデル
  assert.equal(AI_TASKS.article.recommended.anthropic, "claude-opus-5");
  assert.equal(AI_TASKS.tags.recommended.anthropic, "claude-haiku-4-5");
});

test("Claude: Opus 5 はフォールバック有効・JSON スキーマ指定", async () => {
  const m = mockFetch([
    ["POST", /api\.anthropic\.com\/v1\/messages/, () => ({ text: claudeSse("claude-opus-5", '{"tags":["AI"]}'), headers: { "content-type": "text/event-stream" } })],
  ]);
  try {
    const r = await callProvider("anthropic", { apiKey: "k", model: "claude-opus-5", system: "S", user: "U", maxTokens: 4000, json: { name: "tags", schema: SCHEMA } });
    assert.equal(r.text, '{"tags":["AI"]}');
    assert.equal(r.model, "claude-opus-5");
    const c = m.calls[0];
    assert.equal(c.headers["x-api-key"], "k");
    assert.match(c.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
    assert.equal(c.json.fallbacks, "default");
    assert.equal(c.json.stream, true);
    assert.equal(c.json.system, "S");
    assert.deepEqual(c.json.output_config, { format: { type: "json_schema", schema: SCHEMA } });
    assert.equal(c.json.temperature, undefined);
  } finally {
    m.restore();
  }
});

test("Claude: Haiku にはフォールバックを付けない・拒否はエラー", async () => {
  const m = mockFetch([
    ["POST", /api\.anthropic\.com\/v1\/messages/, () => ({ text: claudeSse("claude-haiku-4-5", "", "refusal"), headers: { "content-type": "text/event-stream" } })],
  ]);
  try {
    await assert.rejects(callProvider("anthropic", { apiKey: "k", model: "claude-haiku-4-5", system: "S", user: "U", maxTokens: 4000 }), /断りました/);
    assert.equal(m.calls[0].json.fallbacks, undefined);
    assert.equal(m.calls[0].headers["anthropic-beta"], undefined);
  } finally {
    m.restore();
  }
});

test("OpenAI: Responses API に instructions と json_schema を渡す", async () => {
  const m = mockFetch([
    [
      "POST",
      /api\.openai\.com\/v1\/responses/,
      {
        id: "resp_1",
        object: "response",
        model: "gpt-5-mini",
        output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "こんにちは", annotations: [] }] }],
      },
    ],
  ]);
  try {
    const r = await callProvider("openai", { apiKey: "k", model: "gpt-5-mini", system: "S", user: "U", maxTokens: 4000, json: { name: "tags", schema: SCHEMA } });
    assert.equal(r.text, "こんにちは");
    const c = m.calls[0];
    assert.equal(c.headers.authorization, "Bearer k");
    assert.equal(c.json.instructions, "S");
    assert.equal(c.json.input, "U");
    assert.deepEqual(c.json.text.format, { type: "json_schema", name: "tags", schema: SCHEMA, strict: true });
  } finally {
    m.restore();
  }
});

test("Gemini: systemInstruction と JSON スキーマ", async () => {
  const m = mockFetch([
    ["POST", /generativelanguage\.googleapis\.com\/.*gemini-3\.8-flash:generateContent/, { candidates: [{ content: { role: "model", parts: [{ text: '{"tags":[]}' }] } }] }],
  ]);
  try {
    const r = await callProvider("gemini", { apiKey: "k", model: "gemini-3.8-flash", system: "S", user: "U", maxTokens: 4000, json: { name: "tags", schema: SCHEMA } });
    assert.equal(r.text, '{"tags":[]}');
    const c = m.calls[0];
    assert.equal(c.json.systemInstruction.parts[0].text, "S");
    assert.equal(c.json.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(c.json.generationConfig.responseJsonSchema, SCHEMA);
  } finally {
    m.restore();
  }
});
