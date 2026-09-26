// ==============================================
// AI Router — Gemini content generation (ported from v2)
// ==============================================
// Falls back to deterministic mock output when GEMINI_API_KEY is absent,
// so the whole pipeline can run end-to-end without external services.

import { GoogleGenAI } from "@google/genai";

export interface GeneratePostOptions {
  soulContext: string;
  topic: string;
  platform?: string;
  maxLength?: number;
  /** Extra directive (e.g. from MoodEngine spark) */
  directive?: string;
  /** Sampling temperature — MoodEngine creativityModifier scales this */
  temperature?: number;
}

export interface GeneratedPost {
  text: string;
  model: string;
  mock: boolean;
  error?: string;
}

export function getModelName(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export function isAiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function generatePost(options: GeneratePostOptions): Promise<GeneratedPost> {
  const { soulContext, topic, platform = "x", maxLength = 280, directive, temperature = 0.7 } = options;
  const model = getModelName();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: fallbackMockGeneration(soulContext, topic), model: "mock", mock: true };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const systemInstruction =
      `あなたは以下の「人格定義(Soul)」を持つAIアバターとして振る舞います。\n\n${soulContext}\n\n` +
      `上記の性格、口調、禁止事項を厳守してSNSの投稿を作成してください。出力は投稿のテキストのみとしてください。`;
    const prompt =
      `以下のトピックについて、${platform} で発信する投稿を1件作成してください。` +
      `${maxLength}文字以内に収めてください。\n\nトピック: ${topic}` +
      (directive ? `\n\n今回の特別な指示: ${directive}` : "");

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction, temperature: Math.max(0, Math.min(2, temperature)) },
    });

    const text = response.text?.trim();
    if (!text) return { text: fallbackMockGeneration(soulContext, topic), model, mock: true, error: "empty response" };
    return { text, model, mock: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[AIRouter] Gemini API error:", msg);
    return { text: fallbackMockGeneration(soulContext, topic), model, mock: true, error: msg };
  }
}

/** v2-compatible helper returning only the text. */
export async function generatePostContent(options: GeneratePostOptions): Promise<string> {
  return (await generatePost(options)).text;
}

function fallbackMockGeneration(soulContext: string, topic: string): string {
  if (soulContext.includes("ADHD")) {
    return `【モック生成】\n今日は${topic}についての気づき。\n\n集中力が切れたら、無理せず場所を変えるのが鍵。自分はいつもこれで乗り切ってます。\n\n#ライフハック #生産性`;
  }
  if (soulContext.includes("バイブ")) {
    return `【モック生成】\n${topic}について考えてたんだけど、Claude + Cursorの組み合わせマジで神すぎないか？\nテンション上がる開発で今日もバイブコーディング完了 🚀\n\n#AI開発 #バイブコーディング`;
  }
  return `【モック生成】\nテーマ: ${topic}\n\nGEMINI_API_KEY を .env に設定すると本物のLLMで生成されます。`;
}
