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
import { getSetting, mask, SETTING_KEYS } from "./store";

export type AiProvider = "anthropic" | "openai" | "gemini";
export type AiTask = "post" | "article";

export const AI_PROVIDERS: Record<AiProvider, { name: string; defaultModel: string; keySetting: string; env: string; keyHelp: string; modelHelp: string }> = {
  anthropic: {
    name: "Claude（Anthropic）",
    defaultModel: "claude-opus-5",
    keySetting: SETTING_KEYS.anthropicApiKey,
    env: "ANTHROPIC_API_KEY",
    keyHelp: "platform.claude.com の API Keys で発行",
    modelHelp: "例: claude-opus-5 / claude-sonnet-5 / claude-haiku-4-5（platform.claude.com/docs の Models 一覧）",
  },
  openai: {
    name: "OpenAI",
    defaultModel: "gpt-5",
    keySetting: SETTING_KEYS.openaiApiKey,
    env: "OPENAI_API_KEY",
    keyHelp: "platform.openai.com の API keys で発行",
    modelHelp: "platform.openai.com/docs/models の最新モデル名",
  },
  gemini: {
    name: "Google Gemini",
    defaultModel: "gemini-3.8-flash", // gemini-2.5-flash は 2026-10-16 に提供終了
    keySetting: SETTING_KEYS.geminiApiKey,
    env: "GEMINI_API_KEY",
    keyHelp: "Google AI Studio で発行",
    modelHelp: "ai.google.dev/gemini-api/docs/models の最新モデル名。gemini-2.5-flash は 2026年10月16日に提供終了",
  },
};

/** 「自動」のときの優先順（文章生成は Claude を優先） */
export const AUTO_ORDER: AiProvider[] = ["anthropic", "openai", "gemini"];

export const AI_TASKS: Record<AiTask, { label: string; help: string; providerSetting: string; modelSetting: string }> = {
  post: {
    label: "SNS 投稿文",
    help: "X / Threads / Bluesky / Instagram などの短文投稿",
    providerSetting: SETTING_KEYS.aiPostProvider,
    modelSetting: SETTING_KEYS.aiPostModel,
  },
  article: {
    label: "長文記事",
    help: "WordPress / Zenn / note / Medium 向けの Markdown 記事",
    providerSetting: SETTING_KEYS.aiArticleProvider,
    modelSetting: SETTING_KEYS.aiArticleModel,
  },
};

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && v in AI_PROVIDERS;
}
export function isAiTask(v: unknown): v is AiTask {
  return typeof v === "string" && v in AI_TASKS;
}

export async function providerKey(p: AiProvider): Promise<string | undefined> {
  return (await getSetting(AI_PROVIDERS[p].keySetting)) || process.env[AI_PROVIDERS[p].env] || undefined;
}

/** プロバイダ既定のモデル。Gemini は旧設定 gemini_model を引き継ぐ */
async function providerDefaultModel(p: AiProvider): Promise<string> {
  if (p === "gemini") return (await getSetting(SETTING_KEYS.geminiModel)) || AI_PROVIDERS.gemini.defaultModel;
  return AI_PROVIDERS[p].defaultModel;
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
  const t = AI_TASKS[task];
  const raw = await getSetting(t.providerSetting);
  const selected = isAiProvider(raw) ? raw : "auto";
  let provider: AiProvider | null = selected === "auto" ? null : selected;
  if (!provider) {
    for (const p of AUTO_ORDER) if (await providerKey(p)) { provider = p; break; }
  }
  if (!provider) return { task, selected, provider: null, model: null };
  // モデル指定はプロバイダを明示したときだけ有効（自動で切り替わったとき他社のモデル名を送らない）
  const custom = selected !== "auto" ? await getSetting(t.modelSetting) : undefined;
  return { task, selected, provider, model: custom || (await providerDefaultModel(provider)) };
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
        defaultModel: await providerDefaultModel(id),
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
        provider: r.selected,
        model: (await getSetting(AI_TASKS[id].modelSetting)) ?? "",
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
}

/** 用途に割り当てたプロバイダで文章を生成する。model は実際に応答したモデル名 */
export async function completeText(input: CompleteInput): Promise<{ text: string; model: string; provider: AiProvider }> {
  const r = await resolveAi(input.task);
  if (!r.provider || !r.model) throw new ConfigError("AI の API キーが未設定です（設定 > システム > AI で Claude / OpenAI / Gemini のいずれかを入力）");
  const apiKey = await providerKey(r.provider);
  if (!apiKey) throw new ConfigError(`${AI_PROVIDERS[r.provider].name} の API キーが未設定です（設定 > システム > AI）`);
  const maxTokens = input.task === "article" ? 64000 : 16000;
  const out =
    r.provider === "anthropic"
      ? await callClaude(apiKey, r.model, input.system, input.user, maxTokens)
      : r.provider === "openai"
        ? await callOpenAI(apiKey, r.model, input.system, input.user)
        : await callGemini(apiKey, r.model, input.system, input.user);
  const text = out.text.trim();
  if (!text) throw new Error(`${AI_PROVIDERS[r.provider].name} (${r.model}) から本文が返りませんでした`);
  return { text, model: out.model, provider: r.provider };
}

async function callClaude(apiKey: string, model: string, system: string, user: string, maxTokens: number) {
  const client = new Anthropic({ apiKey });
  // Opus 5 / Fable 5 系は安全分類器で断られることがあるため、サーバー側フォールバックを有効にする
  const fallback = /^claude-(opus-5|fable-5)/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
  // 長文でも HTTP タイムアウトしないようストリーミングで受け取る
  const msg = await client.beta.messages
    .stream({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }], ...fallback })
    .finalMessage();
  if (msg.stop_reason === "refusal") {
    throw new Error(`Claude (${model}) が生成を断りました${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : ""}`);
  }
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  if (msg.stop_reason === "max_tokens") console.warn(`[ai] Claude (${model}) の出力が max_tokens で途切れました`);
  return { text, model: msg.model };
}

async function callOpenAI(apiKey: string, model: string, system: string, user: string) {
  const client = new OpenAI({ apiKey });
  const res = await client.responses.create({ model, instructions: system, input: user });
  return { text: res.output_text ?? "", model: res.model || model };
}

async function callGemini(apiKey: string, model: string, system: string, user: string) {
  // GEMINI_BASE_URL: 社内プロキシ経由などで接続先を変える場合のみ設定（通常は不要）
  const baseUrl = process.env.GEMINI_BASE_URL;
  const ai = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  const res = await ai.models.generateContent({ model, contents: user, config: { systemInstruction: system, temperature: 0.8 } });
  return { text: res.text ?? "", model };
}
