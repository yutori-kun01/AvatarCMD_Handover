// ================================================
// AI 投稿文生成・文字数調整・投稿前チェック・タグ提案 — 用途ごとに Claude / OpenAI / Gemini を使い分ける
// ================================================
// API キーと用途ごとのプロバイダ・モデルはダッシュボードの「設定 > AI 共通・判定 > API キー」と各カテゴリの「〇〇の AI」で入力する。
// プロバイダ呼び出しは ./llm.ts。キー未設定のときはモック文章で投稿しないよう、明示的にエラーにする。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { getPlatform } from "../platforms";
import { completeJson, completeText, type AiTask } from "./llm";
import { cleanPostText } from "../post-text";
import { formatKnowledgeForPrompt, searchKnowledge, type PromptKnowledge } from "./knowledge";

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
  knowledge: PromptKnowledge[]
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
    knowledge.length && formatKnowledgeForPrompt(knowledge),
    "事実と異なる内容や、根拠のない断定はしないでください。出力は投稿本文のみとし、前置きや説明は付けないでください。",
    "本文を「」や引用符で囲まないでください。本文中でも「」は使わないでください。",
    !longForm && "箇条書きを使うときは、1項目ずつ改行して行頭に「・」を付け、箇条書きの前後は空行で区切ってください。",
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

/** アバターと、投稿テーマ（query）に関連するナレッジを読む */
export async function loadAvatarContext(avatarId: string, q: { query?: string; platform?: string; ruleId?: string } = {}) {
  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId } });
  if (!avatar) throw new ConfigError("アバターが見つかりません");
  const found = await searchKnowledge({ avatarId: avatar.id, query: q.query ?? "", platform: q.platform, ruleId: q.ruleId, limit: 6, maxChars: 2500 });
  const knowledge: PromptKnowledge[] = found.map(({ item }) => ({ title: item.title, summary: item.summary, content: item.content, kind: item.kind, sourceUrl: item.sourceUrl, source: item.source }));
  return { avatar, persona: readPersona(avatar.communication), knowledge, knowledgeIds: found.map((f) => f.item.id) };
}

const count = (s: string) => [...s].length;
const truncate = (s: string, limit: number) => (count(s) > limit ? [...s].slice(0, limit - 1).join("") + "…" : s);

export async function generatePostText(input: GenerateInput & { ruleId?: string }): Promise<{ text: string; model: string; provider: string; knowledgeIds: string[] }> {
  const { avatar, persona, knowledge, knowledgeIds } = await loadAvatarContext(input.avatarId, { query: `${input.topic} ${input.extraPrompt ?? ""}`, platform: input.platform, ruleId: input.ruleId });
  const { system, user, limit } = buildPrompts(avatar, persona, input, knowledge);
  const res = await completeText({ task: taskForPlatform(input.platform), system, user });
  const article = taskForPlatform(input.platform) === "article";
  let text = cleanPostText(res.text, { article });
  if (limit && count(text) > limit) {
    // 文字数オーバーは「文字数調整」用途のモデルで短くし、それでも超える分だけ切り詰める
    try {
      text = (await rewriteToFit({ avatarId: input.avatarId, text, maxLength: limit, platform: input.platform })).text;
    } catch (e) {
      console.warn("[ai] 文字数調整に失敗したため切り詰めます:", (e as Error).message);
    }
    text = truncate(cleanPostText(text, { article }), limit);
  }
  return { ...res, text, knowledgeIds };
}

// --- 文字数調整 ---------------------------------------------------------------

export async function rewriteToFit(input: { avatarId: string; text: string; maxLength: number; platform?: string }) {
  const { avatar, persona, knowledge } = await loadAvatarContext(input.avatarId, { query: input.text, platform: input.platform });
  const { system } = buildPrompts(avatar, persona, { topic: "" }, knowledge);
  const def = input.platform ? getPlatform(input.platform) : undefined;
  const user = [
    `次の${def ? `${def.name}向けの` : ""}投稿を、口調・主張・URL・ハッシュタグを保ったまま${input.maxLength}文字以内に書き直してください。`,
    `現在 ${count(input.text)} 文字です。書き直した本文だけを出力してください。`,
    "",
    input.text,
  ].join("\n");
  const res = await completeText({ task: "rewrite", system, user });
  const text = cleanPostText(res.text, { article: taskForPlatform(input.platform) === "article" });
  return { ...res, text: truncate(text, input.maxLength), fitted: count(text) <= input.maxLength };
}

// --- 投稿前チェック -------------------------------------------------------------

export type ReviewVerdict = "ok" | "caution" | "ng";
export interface ReviewResult {
  verdict: ReviewVerdict;
  summary: string;
  issues: { severity: "low" | "medium" | "high"; category: string; message: string; excerpt: string }[];
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["ok", "caution", "ng"] },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          category: { type: "string" },
          message: { type: "string" },
          excerpt: { type: "string" },
        },
        required: ["severity", "category", "message", "excerpt"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "summary", "issues"],
  additionalProperties: false,
};

export async function reviewPost(input: { text: string; avatarId?: string; platform?: string }): Promise<ReviewResult & { model: string }> {
  const rules = input.avatarId ? readPersona((await prisma.avatar.findUnique({ where: { id: input.avatarId } }))?.communication).prompt : undefined;
  const def = input.platform ? getPlatform(input.platform) : undefined;
  const system = [
    "あなたは SNS 運用チームの公開前レビュー担当です。投稿を公開してよいか判定します。",
    "確認する観点: 事実誤り・根拠のない断定、誇大・景品表示法/薬機法に触れうる表現、差別・誹謗中傷・炎上しうる表現、個人情報や機密の露出、アバターのルール違反、プラットフォーム規約違反。",
    rules && `アバターのルール:\n${rules}`,
    "verdict: 問題なし=ok、直した方がよい点がある=caution、公開すべきでない=ng。",
    "issues には具体的な問題だけを入れ、excerpt には該当箇所を本文から引用してください（無ければ空文字）。好みや文体の指摘は入れないでください。summary は日本語で1文。",
  ]
    .filter(Boolean)
    .join("\n");
  const user = `${def ? `投稿先: ${def.name}\n` : ""}--- 投稿本文 ---\n${input.text}`;
  const { data, model } = await completeJson<ReviewResult>({ task: "review", system, user, json: { name: "review", schema: REVIEW_SCHEMA } });
  const verdict: ReviewVerdict = ["ok", "caution", "ng"].includes(data.verdict) ? data.verdict : "caution";
  return { verdict, summary: data.summary ?? "", issues: Array.isArray(data.issues) ? data.issues : [], model };
}

// --- タグ提案 -------------------------------------------------------------------

const TAGS_SCHEMA = {
  type: "object",
  properties: { tags: { type: "array", items: { type: "string" } } },
  required: ["tags"],
  additionalProperties: false,
};

export async function suggestTags(input: { text: string; platform?: string; max?: number }): Promise<{ tags: string[]; model: string }> {
  const max = Math.min(Math.max(input.max ?? 5, 1), 10);
  const def = input.platform ? getPlatform(input.platform) : undefined;
  const system = `あなたは SNS のタグ付け担当です。本文の内容に合い、実際に検索・フォローされやすいタグを最大${max}個提案します。# は付けず、タグ本体だけを返してください。`;
  const user = `${def ? `投稿先: ${def.name}\n` : ""}--- 本文 ---\n${input.text}`;
  const { data, model } = await completeJson<{ tags: string[] }>({ task: "tags", system, user, json: { name: "tags", schema: TAGS_SCHEMA } });
  const tags = [...new Set((data.tags ?? []).map((t) => String(t).replace(/^#+/, "").trim()).filter(Boolean))].slice(0, max);
  return { tags, model };
}
