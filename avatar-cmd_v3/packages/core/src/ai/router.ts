import { GoogleGenAI } from "@google/genai";

export interface GeneratePostOptions {
  soulContext: string;
  topic: string;
  platform?: string;
}

export async function generatePostContent(
  options: GeneratePostOptions,
): Promise<string> {
  const { soulContext, topic } = options;

  console.log("[LLMRouter] Requesting AI Generation using Google Gemini...");
  console.log(`[LLMRouter] Context Length: ${soulContext.length} chars`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が未設定です");
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // プロンプトの組み立て
    const systemInstruction = `あなたは以下の「人格定義(Soul)」を持つAIアバターとして振る舞います。\n\n${soulContext}\n\n上記の性格、口調、禁止事項を厳守してSNSの投稿を作成してください。出力は投稿のテキストのみとしてください。`;
    const prompt = `以下のトピックについて、${options.platform ?? "x"}で発信する投稿を1件作成してください。\n\nトピック: ${topic}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
    });

    if (!response.text?.trim()) throw new Error("AIから本文が返りませんでした");
    return response.text.trim();
  } catch (error) {
    console.error("[LLMRouter] Error calling Gemini API:", error);
    throw new Error(
      "AI生成に失敗しました。接続設定と利用上限を確認してください",
    );
  }
}
