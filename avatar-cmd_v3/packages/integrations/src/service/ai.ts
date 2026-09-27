// ================================================
// AI 投稿文生成（Google Gemini API / 公式SDK @google/genai）
// ================================================
// APIキーとモデルはダッシュボードの「設定 > システム」で入力する。
// 既定モデル: gemini-3.8-flash（gemini-2.5-flash は 2026-10-16 に提供終了）
// キー未設定のときはモック文章で投稿しないよう、明示的にエラーにする。

import { GoogleGenAI } from "@google/genai";
import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getPlatform } from "../platforms";
import { getSetting, SETTING_KEYS } from "./store";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export interface Persona {
  tone?: string;
  topics?: string[];
  postFrequency?: string;
  bestTime?: string;
  /** 口調・禁止事項などの自由記述（システムプロンプトに入る） */
  prompt?: string;
}

export function readPersona(communication: unknown): Persona {
  const c = (communication ?? {}) as Record<string, unknown>;
  return {
    tone: typeof c.tone === "string" ? c.tone : undefined,
    topics: Array.isArray(c.topics) ? (c.topics as unknown[]).map(String) : undefined,
    postFrequency: typeof c.postFrequency === "string" ? c.postFrequency : undefined,
    bestTime: typeof c.bestTime === "string" ? c.bestTime : undefined,
    prompt: typeof c.prompt === "string" ? c.prompt : undefined,
  };
}

export async function geminiModel(): Promise<string> {
  return (await getSetting(SETTING_KEYS.geminiModel)) || DEFAULT_GEMINI_MODEL;
}

export interface GenerateInput {
  avatarId: string;
  topic: string;
  /** 対象プラットフォーム（文字数・書式の指示に使う） */
  platform?: string;
  extraPrompt?: string;
}

export function buildPrompts(
  avatar: { name: string; role: string; description: string | null; specialization: string | null; targetAudience: string | null },
  persona: Persona,
  input: { topic: string; platform?: string; extraPrompt?: string },
  knowledge: { title: string; summary: string | null }[]
) {
  const def = input.platform ? getPlatform(input.platform) : undefined;
  const limit = def?.maxLength && def.maxLength <= 3000 ? def.maxLength : undefined;
  const longForm = ["wordpress", "zenn", "note", "medium"].includes(input.platform ?? "");

  const system = [
    `あなたはSNSで発信するアバター「${avatar.name}」です。`,
    avatar.role && `役割: ${avatar.role}`,
    avatar.specialization && `専門: ${avatar.specialization}`,
    avatar.targetAudience && `想定読者: ${avatar.targetAudience}`,
    avatar.description && `プロフィール: ${avatar.description}`,
    persona.tone && `口調: ${persona.tone}`,
    persona.topics?.length && `得意なトピック: ${persona.topics.join("、")}`,
    persona.prompt && `守るべきルール:\n${persona.prompt}`,
    knowledge.length && `参考にしてよい知識:\n${knowledge.map((k) => `・${k.title}${k.summary ? `: ${k.summary}` : ""}`).join("\n")}`,
    "事実と異なる内容や、根拠のない断定はしないでください。出力は投稿本文のみとし、前置きや説明は付けないでください。",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `次のトピックについて${def ? `${def.name}向けの` : "SNSの"}${longForm ? "記事（Markdown、見出しあり）" : "投稿"}を1件書いてください。`,
    `トピック: ${input.topic}`,
    limit && `文字数は${limit}文字以内（URL・ハッシュタグを含む）に必ず収めてください。`,
    input.extraPrompt && `追加の指示: ${input.extraPrompt}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user, limit };
}

export async function generatePostText(input: GenerateInput): Promise<{ text: string; model: string }> {
  const apiKey = (await getSetting(SETTING_KEYS.geminiApiKey)) || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ConfigError("Gemini API キーが未設定です（設定 > システム > AI）");
  const avatar = await prisma.avatar.findUnique({ where: { id: input.avatarId } });
  if (!avatar) throw new ConfigError("アバターが見つかりません");
  const knowledge = await prisma.knowledgeItem.findMany({
    where: { avatarId: avatar.id, isActive: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { title: true, summary: true },
  });
  const { system, user, limit } = buildPrompts(avatar, readPersona(avatar.communication), input, knowledge);
  const model = await geminiModel();

  // GEMINI_BASE_URL: 社内プロキシ経由などで接続先を変える場合のみ設定（通常は不要）
  const baseUrl = process.env.GEMINI_BASE_URL;
  const ai = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  const res = await ai.models.generateContent({ model, contents: user, config: { systemInstruction: system, temperature: 0.8 } });
  let text = (res.text ?? "").trim();
  if (!text) throw new Error(`Gemini (${model}) から本文が返りませんでした`);
  if (limit && [...text].length > limit) text = [...text].slice(0, limit - 1).join("") + "…";
  return { text, model };
}
