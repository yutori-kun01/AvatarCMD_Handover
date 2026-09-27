// ================================================
// AI 投稿文生成 — 用途（SNS 投稿 / 長文記事）ごとに Claude / OpenAI / Gemini を使い分ける
// ================================================
// API キーと用途ごとのプロバイダ・モデルはダッシュボードの「設定 > システム > AI」で入力する。
// プロバイダ呼び出しは ./llm.ts。キー未設定のときはモック文章で投稿しないよう、明示的にエラーにする。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getPlatform } from "../platforms";
import { completeText, type AiTask } from "./llm";

/** 長文記事として書かせるプラットフォーム */
const LONG_FORM_PLATFORMS = ["wordpress", "zenn", "note", "medium"];

export function taskForPlatform(platform?: string): AiTask {
  return LONG_FORM_PLATFORMS.includes(platform ?? "") ? "article" : "post";
}

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
  const longForm = taskForPlatform(input.platform) === "article";

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

export async function generatePostText(input: GenerateInput): Promise<{ text: string; model: string; provider: string }> {
  const avatar = await prisma.avatar.findUnique({ where: { id: input.avatarId } });
  if (!avatar) throw new ConfigError("アバターが見つかりません");
  const knowledge = await prisma.knowledgeItem.findMany({
    where: { avatarId: avatar.id, isActive: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { title: true, summary: true },
  });
  const { system, user, limit } = buildPrompts(avatar, readPersona(avatar.communication), input, knowledge);
  const res = await completeText({ task: taskForPlatform(input.platform), system, user });
  let text = res.text;
  if (limit && [...text].length > limit) text = [...text].slice(0, limit - 1).join("") + "…";
  return { ...res, text };
}
