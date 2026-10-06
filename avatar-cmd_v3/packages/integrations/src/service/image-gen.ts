// ================================================
// 画像生成（イメージ画像・見出し画像）— OpenAI / Gemini を切り替え
// ================================================
// ・API キーは文章生成と共通（設定 > システム > AI の OpenAI / Gemini）。Claude は画像を生成しないため対象外。
// ・使うプロバイダとモデルは設定で選ぶ（image_provider / image_model_openai / image_model_gemini / image_quality）。
// ・参考画像（アバターのスタイル参照）を一緒に渡し、作風を寄せる。
// ・使用量は共通台帳に記録し（purpose: image_generate）、月の予算を超えていれば止める（assertBudget）。
// ・compareImageProviders(): 同じプロンプトで両方を生成し、時間・使用量・料金表での費用を並べる（品質とコストの比較用）。
// ・v3.7: 既定は OpenAI・品質 high。生成した画像は用途ごとの note 向けサイズに切り抜いて png / webp で保存する
//   （見出し画像 1280×670 = note 推奨、本文の見出し下の画像 1280×720）。図解も同じサイズ・形式にそろえる。

import sharp from "sharp";
import { ConfigError, requestJson } from "../http";
import { providerKey, type InputImage } from "./llm";
import { saveMedia, type MediaRef } from "./media";
import { getSetting, setSetting } from "./store";
import { assertBudget, costOfRow, loadPrices, normalizeGeminiUsage, normalizeOpenAIUsage, recordUsage, type TokenUsage } from "./usage";

export type ImageProvider = "openai" | "gemini";
export type ImageAspect = "16:9" | "1:1" | "4:3";
export type ImageQuality = "low" | "medium" | "high";
export type ImageFormat = "png" | "webp";

/**
 * 用途ごとの出力サイズ。生成は API の横長サイズで行い、中央を基準に切り抜いて縮小する。
 * eyecatch: note の見出し画像（記事一覧のサムネイル。note 推奨 1280×670）
 * section:  本文の大見出し・小見出しの下に入れる画像・図解（16:9。本文の表示幅 620px の 2 倍強）
 */
export const IMAGE_TARGETS = {
  eyecatch: { width: 1280, height: 670, label: "見出し画像（サムネイル）" },
  section: { width: 1280, height: 720, label: "見出しの下の画像・図解" },
} as const;
export type ImageTarget = keyof typeof IMAGE_TARGETS;

/** 画像を用途のサイズに切り抜き（中央基準）、指定の形式に変換する */
export async function fitImage(bytes: Uint8Array, target: ImageTarget | null, format: ImageFormat): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let img = sharp(Buffer.from(bytes));
  if (target) img = img.resize(IMAGE_TARGETS[target].width, IMAGE_TARGETS[target].height, { fit: "cover", position: "attention" });
  const out = format === "webp" ? await img.webp({ quality: 92 }).toBuffer() : await img.png({ compressionLevel: 9 }).toBuffer();
  return { bytes: new Uint8Array(out), mimeType: format === "webp" ? "image/webp" : "image/png" };
}

export const IMAGE_PROVIDERS: Record<ImageProvider, { name: string; defaultModel: string; modelHelp: string; pricingUrl: string }> = {
  openai: {
    name: "OpenAI",
    // 推奨（2026-10 決定）。モデル名は設定画面で変えられる
    defaultModel: "gpt-image2.5-sunburst",
    modelHelp: "推奨: gpt-image2.5-sunburst（品質 high）。最新のモデル名は platform.openai.com/docs/models",
    pricingUrl: "https://platform.openai.com/docs/pricing",
  },
  gemini: {
    name: "Google Gemini",
    defaultModel: "gemini-2.5-flash-image",
    modelHelp: "gemini-2.5-flash-image など画像出力に対応したモデル。最新は ai.google.dev/gemini-api/docs/models",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
};

export const IMAGE_SETTING_KEYS = {
  provider: "image_provider",
  quality: "image_quality",
  format: "image_format",
  model: (p: ImageProvider) => `image_model_${p}`,
};

export interface ImageSettings {
  provider: ImageProvider | null;
  quality: ImageQuality;
  format: ImageFormat;
  models: Record<ImageProvider, string>;
  keys: Record<ImageProvider, boolean>;
}

export async function getImageSettings(): Promise<ImageSettings> {
  const [p, q, f, mo, mg, ko, kg] = await Promise.all([
    getSetting(IMAGE_SETTING_KEYS.provider),
    getSetting(IMAGE_SETTING_KEYS.quality),
    getSetting(IMAGE_SETTING_KEYS.format),
    getSetting(IMAGE_SETTING_KEYS.model("openai")),
    getSetting(IMAGE_SETTING_KEYS.model("gemini")),
    providerKey("openai"),
    providerKey("gemini"),
  ]);
  const keys = { openai: !!ko, gemini: !!kg };
  const selected = p === "openai" || p === "gemini" ? p : null;
  return {
    // 未選択なら OpenAI（2026-10 決定）。OpenAI のキーが無く Gemini だけある場合は Gemini
    provider: selected ?? (keys.openai ? "openai" : keys.gemini ? "gemini" : null),
    quality: q === "low" || q === "medium" ? q : "high",
    // note は PNG を確実に受け付けるため既定は png。webp は容量が小さい
    format: f === "webp" ? "webp" : "png",
    models: { openai: mo || IMAGE_PROVIDERS.openai.defaultModel, gemini: mg || IMAGE_PROVIDERS.gemini.defaultModel },
    keys,
  };
}

export async function saveImageSettings(input: { provider?: string | null; quality?: string | null; format?: string | null; models?: Partial<Record<ImageProvider, string>> }) {
  if (input.format !== undefined) {
    if (input.format && !["png", "webp"].includes(input.format)) throw new ConfigError("画像の形式は png か webp です");
    await setSetting(IMAGE_SETTING_KEYS.format, input.format || null);
  }
  if (input.provider !== undefined) {
    if (input.provider && !(input.provider in IMAGE_PROVIDERS)) throw new ConfigError("画像生成のプロバイダが不正です");
    await setSetting(IMAGE_SETTING_KEYS.provider, input.provider || null);
  }
  if (input.quality !== undefined) {
    if (input.quality && !["low", "medium", "high"].includes(input.quality)) throw new ConfigError("画質の指定が不正です");
    await setSetting(IMAGE_SETTING_KEYS.quality, input.quality || null);
  }
  for (const p of Object.keys(IMAGE_PROVIDERS) as ImageProvider[]) {
    const m = input.models?.[p];
    if (m !== undefined) await setSetting(IMAGE_SETTING_KEYS.model(p), m.trim() || null);
  }
}

export interface ImageRequest {
  prompt: string;
  aspect?: ImageAspect;
  /** 作風を寄せる参考画像（最大 4 枚程度） */
  references?: InputImage[];
  provider?: ImageProvider;
  model?: string;
  quality?: ImageQuality;
  avatarId?: string | null;
  /** 台帳の purpose（既定: image_generate） */
  purpose?: string;
  /** 用途のサイズに切り抜く（指定なしは生成したサイズのまま） */
  target?: ImageTarget;
  /** 出力形式（指定なしは設定の形式） */
  format?: ImageFormat;
}

export interface ImageResult {
  bytes: Uint8Array;
  mimeType: string;
  provider: ImageProvider;
  model: string;
  usage: TokenUsage;
  ms: number;
}

const OPENAI_SIZE: Record<ImageAspect, string> = { "16:9": "1536x1024", "4:3": "1536x1024", "1:1": "1024x1024" };

async function callOpenAIImage(apiKey: string, model: string, req: ImageRequest): Promise<Omit<ImageResult, "provider" | "model" | "ms">> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${apiKey}` };
  const size = OPENAI_SIZE[req.aspect ?? "16:9"];
  const quality = req.quality ?? "high";
  const format = req.format ?? "png";
  let d: any;
  if (req.references?.length) {
    // 参考画像あり: images/edits（複数画像を入力にできる）
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", req.prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", format);
    req.references.slice(0, 4).forEach((r, i) => form.append("image[]", new Blob([Buffer.from(r.data, "base64")], { type: r.mimeType }), `ref-${i}.${r.mimeType.split("/")[1] ?? "png"}`));
    d = await requestJson("openai", `${base}/images/edits`, { method: "POST", headers, body: form });
  } else {
    d = await requestJson("openai", `${base}/images/generations`, { method: "POST", headers, json: { model, prompt: req.prompt, size, quality, output_format: format, n: 1 } });
  }
  const b64 = d.data?.[0]?.b64_json;
  if (typeof b64 !== "string") throw new Error(`OpenAI (${model}) から画像が返りませんでした`);
  return { bytes: new Uint8Array(Buffer.from(b64, "base64")), mimeType: format === "webp" ? "image/webp" : "image/png", usage: normalizeOpenAIUsage(d.usage) };
}

async function callGeminiImage(apiKey: string, model: string, req: ImageRequest): Promise<Omit<ImageResult, "provider" | "model" | "ms">> {
  const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const parts = [...(req.references ?? []).slice(0, 4).map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })), { text: req.prompt }];
  const d: any = await requestJson("gemini", `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey },
    json: {
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspect ?? "16:9" } },
    },
  });
  const part = (d.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
  const inline = part?.inlineData ?? part?.inline_data;
  if (!inline) {
    const reason = d.candidates?.[0]?.finishReason ?? d.promptFeedback?.blockReason;
    throw new Error(`Gemini (${model}) から画像が返りませんでした${reason ? `（${reason}）` : ""}`);
  }
  return { bytes: new Uint8Array(Buffer.from(inline.data, "base64")), mimeType: inline.mimeType ?? inline.mime_type ?? "image/png", usage: normalizeGeminiUsage(d.usageMetadata) };
}

/** プロバイダ API を直接呼ぶ（設定・台帳・予算を使わない。比較スクリプト用） */
export async function callImageProvider(provider: ImageProvider, apiKey: string, model: string, req: ImageRequest): Promise<Omit<ImageResult, "provider" | "model">> {
  const started = Date.now();
  const out = provider === "openai" ? await callOpenAIImage(apiKey, model, req) : await callGeminiImage(apiKey, model, req);
  return { ...out, ms: Date.now() - started };
}

/** 画像を 1 枚生成する（保存はしない） */
export async function generateImage(req: ImageRequest): Promise<ImageResult> {
  if (!req.prompt?.trim()) throw new ConfigError("画像のプロンプトが空です");
  const s = await getImageSettings();
  const provider = req.provider ?? s.provider;
  if (!provider) throw new ConfigError("画像生成には OpenAI か Gemini の API キーが必要です（設定 > システム > AI）");
  const apiKey = await providerKey(provider);
  if (!apiKey) throw new ConfigError(`${IMAGE_PROVIDERS[provider].name} の API キーが未設定です（設定 > システム > AI）`);
  const model = req.model || s.models[provider];
  await assertBudget("画像生成");
  const started = Date.now();
  const purpose = req.purpose ?? "image_generate";
  const format = req.format ?? s.format;
  try {
    const out = provider === "openai" ? await callOpenAIImage(apiKey, model, { ...req, quality: req.quality ?? s.quality, format }) : await callGeminiImage(apiKey, model, req);
    await recordUsage({ provider, model, purpose, avatarId: req.avatarId, ...out.usage, requests: 1 });
    // 用途のサイズに切り抜き・形式をそろえる（Gemini は形式を指定できないのでここで変換）
    const fitted = req.target || out.mimeType !== `image/${format}` ? await fitImage(out.bytes, req.target ?? null, format) : { bytes: out.bytes, mimeType: out.mimeType };
    return { ...out, ...fitted, provider, model, ms: Date.now() - started };
  } catch (e) {
    await recordUsage({ provider, model, purpose, avatarId: req.avatarId, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** 生成して MEDIA_DIR に保存する */
export async function generateAndSaveImage(req: ImageRequest & { filename?: string }): Promise<MediaRef & { provider: ImageProvider; model: string }> {
  const r = await generateImage(req);
  const ref = await saveMedia(r.bytes, req.filename ?? `generated-${r.provider}`, r.mimeType);
  return { ...ref, provider: r.provider, model: r.model };
}

export interface CompareResult {
  provider: ImageProvider;
  model: string;
  ok: boolean;
  ms?: number;
  mediaName?: string;
  usage?: TokenUsage;
  /** 料金表に単価がある場合の費用（通貨ごと）。単価未登録なら空 */
  cost?: Record<string, number>;
  unpriced?: string[];
  error?: string;
}

/**
 * 同じプロンプト・参考画像で、キーのあるプロバイダすべてで生成して比べる（品質は画像を見て判断する）。
 * models を指定すると、そのプロバイダはそのモデルで試す。
 */
export async function compareImageProviders(input: { prompt: string; aspect?: ImageAspect; target?: ImageTarget; references?: InputImage[]; quality?: ImageQuality; models?: Partial<Record<ImageProvider, string>>; avatarId?: string | null }): Promise<CompareResult[]> {
  const s = await getImageSettings();
  const targets = (Object.keys(IMAGE_PROVIDERS) as ImageProvider[]).filter((p) => s.keys[p]);
  if (!targets.length) throw new ConfigError("比較には OpenAI か Gemini の API キーが必要です（設定 > システム > AI）");
  const prices = await loadPrices();
  return Promise.all(
    targets.map(async (provider): Promise<CompareResult> => {
      const model = input.models?.[provider] || s.models[provider];
      try {
        const r = await generateImage({ prompt: input.prompt, aspect: input.aspect, target: input.target, references: input.references, quality: input.quality, provider, model, avatarId: input.avatarId, purpose: "image_compare" });
        const ref = await saveMedia(r.bytes, `compare-${provider}`, r.mimeType);
        const c = costOfRow({ provider, model: r.model, occurredAt: new Date(), ...r.usage, requests: 1, reads: 0, error: null }, prices);
        return { provider, model: r.model, ok: true, ms: r.ms, mediaName: ref.name, usage: r.usage, cost: c.amounts, unpriced: c.unpriced };
      } catch (e) {
        return { provider, model, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
}
