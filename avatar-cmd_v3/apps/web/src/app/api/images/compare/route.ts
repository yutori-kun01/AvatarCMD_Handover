// 画像生成の比較テスト: 同じプロンプトで OpenAI と Gemini の両方を生成し、時間・使用量・費用を並べる
import { NextResponse } from "next/server";
import { compareImageProviders, getAvatarStyles, imagePrompt, referenceImages, type ImageAspect, type ImageQuality } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { prompt: string; aspect?: ImageAspect; quality?: ImageQuality; avatarId?: string; useStyle?: boolean; models?: Record<string, string> };
  if (!b.prompt?.trim()) return NextResponse.json({ error: "プロンプトを入力してください" }, { status: 400 });
  // アバターを選んだ場合は、記事の画像と同じ条件（スタイル定義・参考画像）で比べる
  const useStyle = !!(b.avatarId && b.useStyle);
  const prompt = useStyle ? imagePrompt(b.prompt.trim(), "", (await getAvatarStyles(b.avatarId!)).image) : b.prompt.trim();
  const references = useStyle ? await referenceImages(b.avatarId!, "image", 4) : [];
  const results = await compareImageProviders({ prompt, aspect: b.aspect, quality: b.quality, references, models: b.models, avatarId: b.avatarId ?? null });
  return NextResponse.json({ prompt, references: references.length, results });
});
