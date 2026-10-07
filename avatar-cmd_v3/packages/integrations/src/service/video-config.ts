// ================================================
// 動画パイプライン — 設定（上限値・合格ライン・外部サービスのキー）と固定アセット
// ================================================
// ・指示書の config.yaml に当たるもの。値は「設定 > 動画」で入力し、DB（app_settings）に保存する。
//   API キーは暗号化して保存する（store.ts の SECRET_KEYS）。
// ・固定アセット（キャラ設定書・画風ガイド・声・読み辞書）はアバター（チャンネル）ごと。人が画面で保存したときだけ変わる。
// ・合格ラインと上限値は人が決める。コードから勝手に下げない。

import { ConfigError } from "../http";
import { getSetting, mask, setSetting, SETTING_KEYS } from "./store";
import type { ImageProvider } from "./image-gen";

const isImageProvider = (v: unknown): v is ImageProvider => v === "openai" || v === "gemini";

export const VIDEO_SETTING_KEYS = {
  limits: "video_limits",
  fishApiKey: SETTING_KEYS.videoFishApiKey,
  fishModel: "video_fish_model",
  measureUrl: "video_measure_url",
  measureToken: SETTING_KEYS.videoMeasureToken,
  images: "video_images",
  assetsPrefix: "video_assets_",
} as const;

export interface VideoLimits {
  /** 1 カットあたりの自動作り直しの上限（超えたらカットを止めて人に報告） */
  maxRetries: number;
  /** 1 本あたりの動画化（i2v）カット数の上限 */
  maxI2vShots: number;
  /** 検品の合格ライン（Jev の確信度）。初期値 0.85。最初の 3 本の突き合わせを見て人が決める */
  qcThreshold: number;
  /** 顔の一致度のしきい値（VPS の計測値。この値未満は顔の不一致の疑い） */
  faceThreshold: number;
  /** 1 本あたりの費用上限（超えたら全工程を一時停止） */
  episodeBudget: number;
  /** 1 か月の動画の費用上限（超えたら新しいエピソードを始めない） */
  monthlyBudget: number;
  /** 上限の通貨（料金表の通貨と合わせる） */
  currency: string;
}

export const DEFAULT_VIDEO_LIMITS: VideoLimits = {
  maxRetries: 3,
  maxI2vShots: 30,
  qcThreshold: 0.85,
  faceThreshold: 0.6,
  episodeBudget: 60,
  monthlyBudget: 900,
  currency: "USD",
};

function readJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export async function getVideoLimits(): Promise<VideoLimits> {
  return readJson(await getSetting(VIDEO_SETTING_KEYS.limits), DEFAULT_VIDEO_LIMITS);
}

/** 上限値を保存する。範囲外の値は丸める */
export function normalizeLimits(input: Partial<Record<keyof VideoLimits, unknown>>, cur: VideoLimits): VideoLimits {
  const currency = typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency.trim()) ? input.currency.trim() : cur.currency;
  return {
    maxRetries: Math.round(num(input.maxRetries, 0, 10, cur.maxRetries)),
    maxI2vShots: Math.round(num(input.maxI2vShots, 0, 500, cur.maxI2vShots)),
    qcThreshold: num(input.qcThreshold, 0.5, 0.99, cur.qcThreshold),
    faceThreshold: num(input.faceThreshold, 0, 1, cur.faceThreshold),
    episodeBudget: num(input.episodeBudget, 0, 1_000_000, cur.episodeBudget),
    monthlyBudget: num(input.monthlyBudget, 0, 10_000_000, cur.monthlyBudget),
    currency,
  };
}

/** 工程ごとの画像生成（絵コンテは安く速く、本番は高品質）。空欄は「設定 > 画像生成」の既定 */
export interface VideoImageSettings {
  storyboard: { provider: ImageProvider | null; model: string; quality: "low" | "medium" | "high" };
  final: { provider: ImageProvider | null; model: string; quality: "low" | "medium" | "high"; compare: boolean };
  thumbnail: { provider: ImageProvider | null; model: string };
}

export const DEFAULT_VIDEO_IMAGES: VideoImageSettings = {
  storyboard: { provider: "gemini", model: "", quality: "low" },
  final: { provider: null, model: "", quality: "high", compare: false },
  thumbnail: { provider: "openai", model: "" },
};

export async function getVideoImageSettings(): Promise<VideoImageSettings> {
  const raw = readJson<Partial<VideoImageSettings>>(await getSetting(VIDEO_SETTING_KEYS.images), {});
  const q = (v: unknown, f: "low" | "medium" | "high") => (v === "low" || v === "medium" || v === "high" ? v : f);
  const p = (v: unknown, f: ImageProvider | null) => (v === null || v === "" ? null : isImageProvider(v) ? v : f);
  const m = (v: unknown) => (typeof v === "string" && /^[a-z0-9._\-]*$/i.test(v) ? v : "");
  return {
    storyboard: { provider: p(raw.storyboard?.provider, DEFAULT_VIDEO_IMAGES.storyboard.provider), model: m(raw.storyboard?.model), quality: q(raw.storyboard?.quality, "low") },
    final: { provider: p(raw.final?.provider, null), model: m(raw.final?.model), quality: q(raw.final?.quality, "high"), compare: raw.final?.compare === true },
    thumbnail: { provider: p(raw.thumbnail?.provider, DEFAULT_VIDEO_IMAGES.thumbnail.provider), model: m(raw.thumbnail?.model) },
  };
}

// --- 外部サービス -------------------------------------------------------------------

export interface FishConfig {
  apiKey: string;
  model: string;
}

/** Fish Audio（ナレーション・文字起こし）。キーが無ければ null（文字数からの見積もりで尺を仮決めする） */
export async function fishConfig(): Promise<FishConfig | null> {
  const apiKey = (await getSetting(VIDEO_SETTING_KEYS.fishApiKey)) || process.env.FISH_AUDIO_API_KEY || "";
  if (!apiKey) return null;
  return { apiKey, model: (await getSetting(VIDEO_SETTING_KEYS.fishModel)) || process.env.FISH_AUDIO_MODEL || "s2-pro" };
}

export interface MeasureConfig {
  url: string;
  token: string;
}

/** VPS の計測サーバー（顔認識・OCR・骨格推定・構図）。未設定なら null（計測値なしで判定する） */
export async function measureConfig(): Promise<MeasureConfig | null> {
  const url = ((await getSetting(VIDEO_SETTING_KEYS.measureUrl)) || process.env.VIDEO_MEASURE_URL || "").replace(/\/+$/, "");
  if (!url) return null;
  return { url, token: (await getSetting(VIDEO_SETTING_KEYS.measureToken)) || process.env.VIDEO_MEASURE_TOKEN || "" };
}

// --- 固定アセット（アバター = チャンネルごと） -------------------------------------------------

export interface VideoAssets {
  /** キャラ設定（髪型・髪色・目の色・服装・小物・体型・年齢感）。画像生成の毎回のプロンプト冒頭に入れる */
  characterText: string;
  /** キャラ設定書の画像（正面・横・斜め45度・表情差分）。media 名。先頭が正面図（顔の基準） */
  characterImages: string[];
  /** 画風ガイド（色味・光・線の太さ・背景の描き込み量） */
  styleText: string;
  /** 画風の基準画像（5 枚程度） */
  styleImages: string[];
  /** Fish Audio の声 ID（1 つに固定） */
  voiceId: string;
  /** 読み辞書（表記 → 読み） */
  readingDict: { from: string; to: string }[];
  /** Kling のエレメント ID（キャラの紐づけ） */
  klingElementId: string;
  /** 字幕・テロップのブランド設定 */
  brand: { font: string; color: string; outline: string };
  /** 人が確定した日時（未確定のあいだはパイプラインを始められない） */
  approvedAt: string | null;
}

export const EMPTY_VIDEO_ASSETS: VideoAssets = {
  characterText: "",
  characterImages: [],
  styleText: "",
  styleImages: [],
  voiceId: "",
  readingDict: [],
  klingElementId: "",
  brand: { font: "Noto Sans JP", color: "#FFD400", outline: "#000000" },
  approvedAt: null,
};

const MEDIA_RE = /^[a-f0-9-]{36}\.(jpg|png|gif|webp)$/;

export async function getVideoAssets(avatarId: string): Promise<VideoAssets> {
  const a = readJson<VideoAssets>(await getSetting(VIDEO_SETTING_KEYS.assetsPrefix + avatarId), EMPTY_VIDEO_ASSETS);
  return { ...a, brand: { ...EMPTY_VIDEO_ASSETS.brand, ...(a.brand ?? {}) } };
}

/** 固定アセットを保存する（人の操作でのみ呼ぶ）。approve: true で「確定」にする */
export async function saveVideoAssets(avatarId: string, input: Partial<VideoAssets> & { approve?: boolean }): Promise<VideoAssets> {
  if (!avatarId) throw new ConfigError("アバターを選択してください");
  const cur = await getVideoAssets(avatarId);
  const text = (v: unknown, max: number, f: string) => (typeof v === "string" ? v.trim().slice(0, max) : f);
  const images = (v: unknown, f: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && MEDIA_RE.test(x)).slice(0, 12) : f);
  const dict = Array.isArray(input.readingDict)
    ? input.readingDict
        .map((d) => ({ from: text(d?.from, 100, ""), to: text(d?.to, 100, "") }))
        .filter((d) => d.from && d.to)
        .slice(0, 500)
    : cur.readingDict;
  const color = (v: unknown, f: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : f);
  const next: VideoAssets = {
    characterText: text(input.characterText, 4000, cur.characterText),
    characterImages: images(input.characterImages, cur.characterImages),
    styleText: text(input.styleText, 4000, cur.styleText),
    styleImages: images(input.styleImages, cur.styleImages),
    voiceId: text(input.voiceId, 200, cur.voiceId),
    readingDict: dict,
    klingElementId: text(input.klingElementId, 200, cur.klingElementId),
    brand: {
      font: text(input.brand?.font, 100, cur.brand.font),
      color: color(input.brand?.color, cur.brand.color),
      outline: color(input.brand?.outline, cur.brand.outline),
    },
    approvedAt: input.approve ? new Date().toISOString() : cur.approvedAt,
  };
  await setSetting(VIDEO_SETTING_KEYS.assetsPrefix + avatarId, JSON.stringify(next));
  return next;
}

/** 設定画面用（秘密の値は伏せ字） */
export async function describeVideoSettings() {
  const fishKey = await getSetting(VIDEO_SETTING_KEYS.fishApiKey);
  const measureToken = await getSetting(VIDEO_SETTING_KEYS.measureToken);
  return {
    limits: await getVideoLimits(),
    images: await getVideoImageSettings(),
    fish: {
      apiKey: fishKey ? mask(fishKey) : "",
      fromEnv: !fishKey && !!process.env.FISH_AUDIO_API_KEY,
      model: (await getSetting(VIDEO_SETTING_KEYS.fishModel)) ?? "",
      defaultModel: "s2-pro",
    },
    measure: {
      url: (await getSetting(VIDEO_SETTING_KEYS.measureUrl)) ?? "",
      fromEnv: !!process.env.VIDEO_MEASURE_URL,
      token: measureToken ? mask(measureToken) : "",
    },
  };
}

export interface VideoSettingsInput {
  limits?: Partial<Record<keyof VideoLimits, unknown>>;
  images?: Partial<VideoImageSettings>;
  /** 空欄 = 変更しない、"-" = 削除 */
  fishApiKey?: string;
  fishModel?: string;
  measureUrl?: string;
  measureToken?: string;
}

export async function saveVideoSettings(input: VideoSettingsInput): Promise<void> {
  if (input.limits) await setSetting(VIDEO_SETTING_KEYS.limits, JSON.stringify(normalizeLimits(input.limits, await getVideoLimits())));
  if (input.images) {
    const cur = await getVideoImageSettings();
    const merged = {
      storyboard: { ...cur.storyboard, ...(input.images.storyboard ?? {}) },
      final: { ...cur.final, ...(input.images.final ?? {}) },
      thumbnail: { ...cur.thumbnail, ...(input.images.thumbnail ?? {}) },
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v.model && !/^[a-z0-9._\-]+$/i.test(v.model)) throw new ConfigError(`画像モデル名が不正です（${k}）: ${v.model}`);
      if (v.provider !== null && v.provider !== undefined && (v.provider as string) !== "" && !isImageProvider(v.provider)) throw new ConfigError(`画像プロバイダが不正です（${k}）`);
    }
    await setSetting(VIDEO_SETTING_KEYS.images, JSON.stringify(merged));
  }
  if (input.fishModel !== undefined) {
    const m = input.fishModel.trim();
    if (m && !/^[a-z0-9._\-]+$/i.test(m)) throw new ConfigError(`Fish Audio のモデル名が不正です: ${m}`);
    await setSetting(VIDEO_SETTING_KEYS.fishModel, m || null);
  }
  const fk = input.fishApiKey?.trim();
  if (fk) await setSetting(VIDEO_SETTING_KEYS.fishApiKey, fk === "-" ? null : fk);
  if (input.measureUrl !== undefined) {
    const u = input.measureUrl.trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\/[^/]+/.test(u)) throw new ConfigError("計測サーバーの URL は http(s):// から始めてください");
    await setSetting(VIDEO_SETTING_KEYS.measureUrl, u || null);
  }
  const mt = input.measureToken?.trim();
  if (mt) await setSetting(VIDEO_SETTING_KEYS.measureToken, mt === "-" ? null : mt);
}
