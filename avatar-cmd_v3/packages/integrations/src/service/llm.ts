// ================================================
// LLM プロバイダ層 — 用途（タスク）ごとに Claude / OpenAI / Gemini を使い分ける
// ================================================
// ・API キーはダッシュボードの「設定 > システム > AI」で入力（暗号化して DB に保存）。
//   未入力なら環境変数 ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY を使う。
// ・用途ごとに「プロバイダ」と「モデル」を選べる。プロバイダが「自動」のときは
//   キーが設定済みのものを Claude → OpenAI → Gemini の順で選ぶ。
// ・接続先を変える場合は ANTHROPIC_BASE_URL / OPENAI_BASE_URL（各 SDK が自動で読む）、
//   GEMINI_BASE_URL を設定する（通常は不要）。

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { ConfigError } from "../http";
import { getSetting, mask, setSetting, SETTING_KEYS } from "./store";

export type AiProvider = "anthropic" | "openai" | "gemini";

export const AI_PROVIDERS: Record<AiProvider, { name: string; keySetting: string; env: string; keyHelp: string; modelHelp: string }> = {
  anthropic: {
    name: "Claude（Anthropic）",
    keySetting: SETTING_KEYS.anthropicApiKey,
    env: "ANTHROPIC_API_KEY",
    keyHelp: "platform.claude.com の API Keys で発行",
    modelHelp: "claude-opus-5（最高品質）/ claude-sonnet-5（標準）/ claude-haiku-4-5（高速・低価格）",
  },
  openai: {
    name: "OpenAI",
    keySetting: SETTING_KEYS.openaiApiKey,
    env: "OPENAI_API_KEY",
    keyHelp: "platform.openai.com の API keys で発行",
    modelHelp: "platform.openai.com/docs/models の最新モデル名",
  },
  gemini: {
    name: "Google Gemini",
    keySetting: SETTING_KEYS.geminiApiKey,
    env: "GEMINI_API_KEY",
    keyHelp: "Google AI Studio で発行",
    modelHelp: "ai.google.dev/gemini-api/docs/models の最新モデル名。gemini-2.5-flash は 2026年10月16日に提供終了",
  },
};

/** 「自動」のときの優先順（文章生成は Claude を優先） */
export const AUTO_ORDER: AiProvider[] = ["anthropic", "openai", "gemini"];

// --- 用途（タスク） -----------------------------------------------------------
// recommended: その用途で「これ以上は下げない」最低限の推奨モデル（モデル欄が空欄のときの既定）。
// upgrade:     品質を上げたいときの候補（設定画面にヒントとして表示）。

export type AiTask = "post" | "article" | "rewrite" | "review" | "tags" | "quote";

export interface AiTaskDef {
  label: string;
  help: string;
  recommended: Record<AiProvider, string>;
  upgrade?: Partial<Record<AiProvider, string>>;
  /** 出力の上限トークン（思考分を含む） */
  maxTokens: number;
}

export const AI_TASKS: Record<AiTask, AiTaskDef> = {
  post: {
    label: "SNS 投稿文",
    help: "X / Threads / Bluesky / Instagram などの短文投稿。アバターの口調を守る力が要る",
    recommended: { anthropic: "claude-sonnet-5", openai: "gpt-5-mini", gemini: "gemini-3.8-flash" },
    upgrade: { anthropic: "claude-opus-5", openai: "gpt-5" },
    maxTokens: 16000,
  },
  article: {
    label: "長文記事",
    help: "WordPress / Zenn / note / Medium 向けの Markdown 記事。構成力と正確さが要る",
    recommended: { anthropic: "claude-opus-5", openai: "gpt-5", gemini: "gemini-3.8-flash" },
    maxTokens: 64000,
  },
  rewrite: {
    label: "文字数調整",
    help: "文字数制限を超えた本文を、口調を保ったまま短くする",
    recommended: { anthropic: "claude-sonnet-5", openai: "gpt-5-mini", gemini: "gemini-3.8-flash" },
    maxTokens: 16000,
  },
  review: {
    label: "投稿前チェック",
    help: "事実誤り・誇大表現・炎上リスク・個人情報をチェック。自動投稿では問題があれば下書きに回す",
    recommended: { anthropic: "claude-sonnet-5", openai: "gpt-5-mini", gemini: "gemini-3.8-flash" },
    upgrade: { anthropic: "claude-opus-5", openai: "gpt-5" },
    maxTokens: 16000,
  },
  quote: {
    label: "引用投稿",
    help: "タイムラインの投稿を引用し、肯定しつつアバターの知見・体験を添える文章。Jev 未設定時は引用してよいかの判定にも使う",
    recommended: { anthropic: "claude-sonnet-5", openai: "gpt-5-mini", gemini: "gemini-3.8-flash" },
    upgrade: { anthropic: "claude-opus-5", openai: "gpt-5" },
    maxTokens: 16000,
  },
  tags: {
    label: "タグ提案",
    help: "本文からハッシュタグ・記事タグを提案する単純作業",
    recommended: { anthropic: "claude-haiku-4-5", openai: "gpt-5-mini", gemini: "gemini-3.8-flash" },
    maxTokens: 4000,
  },
};

const providerSettingKey = (task: AiTask) => `ai_${task}_provider`;
const modelSettingKey = (task: AiTask) => `ai_${task}_model`;

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(AI_PROVIDERS, v);
}
export function isAiTask(v: unknown): v is AiTask {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(AI_TASKS, v);
}

export async function providerKey(p: AiProvider): Promise<string | undefined> {
  return (await getSetting(AI_PROVIDERS[p].keySetting)) || process.env[AI_PROVIDERS[p].env] || undefined;
}

/** 用途の既定モデル（推奨）。Gemini は旧設定 gemini_model（全用途共通）があればそれを引き継ぐ */
async function defaultModel(task: AiTask, p: AiProvider): Promise<string> {
  if (p === "gemini") {
    const legacy = await getSetting(SETTING_KEYS.geminiModel);
    if (legacy) return legacy;
  }
  return AI_TASKS[task].recommended[p];
}

/** 用途ごとの割り当てを保存する（provider: "auto" で自動） */
export async function saveAiTask(task: AiTask, provider: AiProvider | "auto", model: string): Promise<void> {
  await setSetting(providerSettingKey(task), provider === "auto" ? null : provider);
  // 自動のときはモデル指定を持たない（切り替わった先のプロバイダに合わないため）
  await setSetting(modelSettingKey(task), provider === "auto" ? null : model || null);
}

export interface ResolvedAi {
  task: AiTask;
  /** 設定値（"auto" = 自動） */
  selected: AiProvider | "auto";
  /** 実際に使うプロバイダ（キーが無く決まらないときは null） */
  provider: AiProvider | null;
  model: string | null;
}

export async function resolveAi(task: AiTask): Promise<ResolvedAi> {
  const raw = await getSetting(providerSettingKey(task));
  const selected = isAiProvider(raw) ? raw : "auto";
  let provider: AiProvider | null = selected === "auto" ? null : selected;
  if (!provider) {
    for (const p of AUTO_ORDER) if (await providerKey(p)) { provider = p; break; }
  }
  if (!provider) return { task, selected, provider: null, model: null };
  // モデル指定はプロバイダを明示したときだけ有効（自動で切り替わったとき他社のモデル名を送らない）
  const custom = selected !== "auto" ? await getSetting(modelSettingKey(task)) : undefined;
  return { task, selected, provider, model: custom || (await defaultModel(task, provider)) };
}

/** 設定画面用: キーの登録状況（伏せ字）と用途ごとの割り当て */
export async function describeAi() {
  const providers = await Promise.all(
    (Object.keys(AI_PROVIDERS) as AiProvider[]).map(async (id) => {
      const def = AI_PROVIDERS[id];
      const saved = await getSetting(def.keySetting);
      return {
        id,
        name: def.name,
        keyHelp: def.keyHelp,
        modelHelp: def.modelHelp,
        apiKey: saved ? mask(saved) : "",
        fromEnv: !saved && !!process.env[def.env],
        env: def.env,
      };
    })
  );
  const tasks = await Promise.all(
    (Object.keys(AI_TASKS) as AiTask[]).map(async (id) => {
      const r = await resolveAi(id);
      return {
        id,
        label: AI_TASKS[id].label,
        help: AI_TASKS[id].help,
        /** プロバイダごとの既定（推奨）モデル */
        defaults: Object.fromEntries(await Promise.all((Object.keys(AI_PROVIDERS) as AiProvider[]).map(async (p) => [p, await defaultModel(id, p)]))),
        upgrade: AI_TASKS[id].upgrade ?? {},
        provider: r.selected,
        model: (await getSetting(modelSettingKey(id))) ?? "",
        effectiveProvider: r.provider,
        effectiveModel: r.model,
      };
    })
  );
  const hasKey = new Set(providers.filter((p) => p.apiKey || p.fromEnv).map((p) => p.id));
  return { providers, tasks, ready: tasks.every((t) => !!t.effectiveProvider && hasKey.has(t.effectiveProvider)) };
}

// --- 生成 ------------------------------------------------------------------

export interface CompleteInput {
  task: AiTask;
  system: string;
  user: string;
  /** 指定すると JSON スキーマに沿った出力を強制する（各社の構造化出力機能を使う） */
  json?: { name: string; schema: Record<string, unknown> };
}

/** 用途に割り当てたプロバイダで生成する。model は実際に応答したモデル名 */
export async function completeText(input: CompleteInput): Promise<{ text: string; model: string; provider: AiProvider }> {
  const r = await resolveAi(input.task);
  if (!r.provider || !r.model) throw new ConfigError("AI の API キーが未設定です（設定 > システム > AI で Claude / OpenAI / Gemini のいずれかを入力）");
  const apiKey = await providerKey(r.provider);
  if (!apiKey) throw new ConfigError(`${AI_PROVIDERS[r.provider].name} の API キーが未設定です（設定 > システム > AI）`);
  const out = await callProvider(r.provider, { apiKey, model: r.model, system: input.system, user: input.user, maxTokens: AI_TASKS[input.task].maxTokens, json: input.json });
  const text = out.text.trim();
  if (!text) throw new Error(`${AI_PROVIDERS[r.provider].name} (${r.model}) から本文が返りませんでした`);
  return { text, model: out.model, provider: r.provider };
}

/** JSON 出力を受け取ってパースする */
export async function completeJson<T>(input: CompleteInput & { json: NonNullable<CompleteInput["json"]> }): Promise<{ data: T; model: string; provider: AiProvider }> {
  const res = await completeText(input);
  // 念のためコードフェンスで囲まれて返った場合も読む
  const raw = res.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return { data: JSON.parse(raw) as T, model: res.model, provider: res.provider };
  } catch {
    throw new Error(`${res.model} の応答を JSON として読めませんでした: ${res.text.slice(0, 200)}`);
  }
}

export interface ProviderRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  json?: CompleteInput["json"];
}

/** プロバイダ API を直接呼ぶ（設定の解決はしない） */
export function callProvider(provider: AiProvider, req: ProviderRequest): Promise<{ text: string; model: string }> {
  return provider === "anthropic" ? callClaude(req) : provider === "openai" ? callOpenAI(req) : callGemini(req);
}

async function callClaude({ apiKey, model, system, user, maxTokens, json }: ProviderRequest) {
  const client = new Anthropic({ apiKey });
  // Opus 5 / Fable 5 系は安全分類器で断られることがあるため、サーバー側フォールバックを有効にする
  const fallback = /^claude-(opus-5|fable-5)/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
  // 長文でも HTTP タイムアウトしないようストリーミングで受け取る
  const msg = await client.beta.messages
    .stream({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      ...(json ? { output_config: { format: { type: "json_schema", schema: json.schema } } } : {}),
      ...fallback,
    })
    .finalMessage();
  if (msg.stop_reason === "refusal") {
    throw new Error(`Claude (${model}) が生成を断りました${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : ""}`);
  }
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  if (msg.stop_reason === "max_tokens") console.warn(`[ai] Claude (${model}) の出力が max_tokens で途切れました`);
  return { text, model: msg.model };
}

async function callOpenAI({ apiKey, model, system, user, json }: ProviderRequest) {
  const client = new OpenAI({ apiKey });
  const res = await client.responses.create({
    model,
    instructions: system,
    input: user,
    ...(json ? { text: { format: { type: "json_schema" as const, name: json.name, schema: json.schema, strict: true } } } : {}),
  });
  return { text: res.output_text ?? "", model: res.model || model };
}

async function callGemini({ apiKey, model, system, user, json }: ProviderRequest) {
  // GEMINI_BASE_URL: 社内プロキシ経由などで接続先を変える場合のみ設定（通常は不要）
  const baseUrl = process.env.GEMINI_BASE_URL;
  const ai = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  const res = await ai.models.generateContent({
    model,
    contents: user,
    config: {
      systemInstruction: system,
      temperature: json ? 0.2 : 0.8,
      ...(json ? { responseMimeType: "application/json", responseJsonSchema: json.schema } : {}),
    },
  });
  return { text: res.text ?? "", model };
}
