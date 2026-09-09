import { GoogleGenAI } from "@google/genai";

export interface GeneratePostOptions {
  soulContext: string;
  topic: string;
}

export async function generatePostContent(options: GeneratePostOptions): Promise<string> {
  const { soulContext, topic } = options;

  console.log("[LLMRouter] Requesting AI Generation using Google Gemini...");
  console.log(`[LLMRouter] Context Length: ${soulContext.length} chars`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[LLMRouter] GEMINI_API_KEY is not set. Falling back to mock generation.");
    return fallbackMockGeneration(soulContext, topic);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // プロンプトの組み立て
    const systemInstruction = `あなたは以下の「人格定義(Soul)」を持つAIアバターとして振る舞います。\n\n${soulContext}\n\n上記の性格、口調、禁止事項を厳守してSNSの投稿を作成してください。出力は投稿のテキストのみとしてください。`;
    const prompt = `以下のトピックについて、SNS（X / Twitterなど）で発信する投稿を1件作成してください。\n\nトピック: ${topic}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      }
    });

    return response.text || "生成に失敗しました。";
  } catch (error) {
    console.error("[LLMRouter] Error calling Gemini API:", error);
    return `生成中にエラーが発生しました。\n\nトピック: ${topic}`;
  }
}

// GEMINI_API_KEY が設定されていない場合のモック用フォールバック
function fallbackMockGeneration(soulContext: string, topic: string): string {
  const isAdhd = soulContext.includes("ADHD");
  const isVibe = soulContext.includes("バイブ");

  if (isAdhd) {
    return `【API未設定/モック稼働】\n今日は${topic}についての気づき。\n\n集中力が切れたら、無理せず場所を変えるのが鍵。自分はいつもこれで乗り切ってます。\n\n#ライフハック #生産性`;
  } else if (isVibe) {
    return `Yo! ${topic}について考えてたんだけど、Claude + Cursorの組み合わせマジで神すぎないか？\nテンション上がる開発で今日もバイブコーディング完了 🚀\n\n#AI開発 #バイブコーディング`;
  }

  return `【API未設定/モック稼働】\nテーマ: ${topic}\n\nP.S. GEMINI_API_KEY を .env に設定すると本物のLLMが稼働します。`;
}
