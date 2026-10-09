// ================================================
// 動画パイプライン — ナレーション（Fish Audio の音声合成・文字起こし）
// ================================================
// 公式: https://docs.fish.audio/
//   - 音声合成: POST https://api.fish.audio/v1/tts（JSON: text / reference_id / format。ヘッダ model でモデルを選ぶ）
//   - 文字起こし: POST https://api.fish.audio/v1/asr（multipart: audio / language / ignore_timestamps=false → segments の開始・終了時刻）
// ・声は 1 つに固定（固定アセットの voiceId）。読み辞書を適用してから合成する。
// ・章ごとに合成し、つなぎ目に 0.4 秒の無音を入れる前提で各章の開始位置（offset）を計算する（結合は書き出し側で行う）。
// ・合成した音声を文字起こしし、台本との一致率が低い章は読み間違いの可能性として報告する（読み辞書に追記して作り直す）。
// ・API の仕様は導入前に公式ドキュメントで確認すること（2026-10 時点の公開情報にもとづく）。

import { ConfigError, request, requestJson } from "../http";
import type { FishConfig } from "./video-config";
import { recordUsage } from "./usage";
import type { WordTiming } from "./video-shotlist";

const API = process.env.FISH_AUDIO_BASE_URL || "https://api.fish.audio";

/** 章のつなぎ目の無音（秒） */
export const CHAPTER_GAP_SEC = 0.4;

/** 読み辞書を適用する（長い表記から順に置き換える。同じ語の部分一致で崩れないように） */
export function applyReadingDict(text: string, dict: { from: string; to: string }[]): string {
  const sorted = [...dict].filter((d) => d.from).sort((a, b) => b.from.length - a.from.length);
  if (!sorted.length) return text;
  const re = new RegExp(sorted.map((d) => d.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const map = new Map(sorted.map((d) => [d.from, d.to]));
  return text.replace(re, (m) => map.get(m) ?? m);
}

export async function synthesize(cfg: FishConfig, voiceId: string, text: string): Promise<Uint8Array> {
  if (!voiceId) throw new ConfigError("声 ID が未設定です（設定 > 動画 > 固定アセット）");
  try {
    const res = await request("fish_audio", `${API}/v1/tts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, model: cfg.model },
      json: { text, reference_id: voiceId, format: "mp3", mp3_bitrate: 128, normalize: true, latency: "normal" },
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    await recordUsage({ provider: "fish_audio", model: cfg.model, purpose: "video_tts", reads: text.length });
    return bytes;
  } catch (e) {
    await recordUsage({ provider: "fish_audio", model: cfg.model, purpose: "video_tts", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export interface Transcript {
  text: string;
  duration: number;
  segments: WordTiming[];
}

export async function transcribe(cfg: FishConfig, audio: Uint8Array, language = "ja"): Promise<Transcript> {
  const form = new FormData();
  form.append("audio", new Blob([Buffer.from(audio)], { type: "audio/mpeg" }), "narration.mp3");
  form.append("language", language);
  form.append("ignore_timestamps", "false");
  try {
    const d = await requestJson<{ text?: string; duration?: number; segments?: { text?: string; start?: number; end?: number }[] }>("fish_audio", `${API}/v1/asr`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    const segments = (d.segments ?? [])
      .filter((s) => typeof s.start === "number" && typeof s.end === "number")
      .map((s) => ({ text: s.text ?? "", start: s.start!, end: s.end! }));
    const duration = typeof d.duration === "number" ? d.duration : segments.length ? segments[segments.length - 1].end : 0;
    await recordUsage({ provider: "fish_audio", purpose: "video_asr", reads: Math.round(duration) });
    return { text: d.text ?? segments.map((s) => s.text).join(""), duration, segments };
  } catch (e) {
    await recordUsage({ provider: "fish_audio", purpose: "video_asr", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * 台本と文字起こしの一致率（0〜1）。記号・空白を除いた文字の 2-gram の重なりで測る。
 * 読み辞書を適用した台本と比べると、かな書きにした語も一致として数えられる。
 */
export function scriptMatchRate(script: string, transcript: string): number {
  const clean = (t: string) => t.replace(/[\s、。，．,.!?！？「」『』（）()…・ー―\-"'“”]/g, "");
  const grams = (t: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const a = grams(clean(script));
  const b = grams(clean(transcript));
  const total = [...a.values()].reduce((x, y) => x + y, 0);
  if (!total) return 1;
  let hit = 0;
  for (const [g, n] of a) hit += Math.min(n, b.get(g) ?? 0);
  return hit / total;
}
