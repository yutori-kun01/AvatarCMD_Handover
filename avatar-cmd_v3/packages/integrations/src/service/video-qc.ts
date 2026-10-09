// ================================================
// 動画パイプライン — 検品（測るのは VPS、決めるのは Jev、迷ったら Claude）
// ================================================
// 1. VPS の計測サーバーで画像を数値に変える（顔の一致度・文字の混入・手指の破綻・構図）。Jev は文字しか受け付けないため。
// 2. Jev に「カットの指示 + 計測値」を渡し、合格 / 作り直し / 保留 と理由を確率付きで返してもらう。
// 3. 判定後の処理は qcNextAction（コードのルール）で決める:
//      合格かつ確信度が合格ライン以上 → 次の工程へ
//      作り直しかつ確信度が合格ライン以上 → 理由をプロンプトに反映して自動で作り直す（上限まで）
//      保留・確信度が合格ライン未満 → Claude（画像を読める AI）が画像とカット指示書を見て決める
//      作り直しが上限に達した → カットを止めて人に報告
// ・Jev のモードが shadow（記録のみ）のときは Jev の判定を記録するだけで、毎回 Claude が決める。
// ・Jev も Claude も使えないときは判定せず「保留」にし、人が絵コンテ承認で見る。

import { choice } from "@typesafe-ai/sdk";
import { ConfigError, requestJson } from "../http";
import { decideWithJev, topChoice } from "./decision";
import { completeJson } from "./llm";
import { readMedia, type MediaRef } from "./media";
import type { MeasureConfig, VideoLimits } from "./video-config";
import type { QcReason, QcResult, Shot } from "./video-shotlist";

export interface QcMetrics {
  /** キャラ設定書の基準との顔の類似度（0〜1）。キャラなしカットは null */
  face_similarity?: number | null;
  /** OCR で見つかった文字 */
  text_detected?: string[];
  /** 文字の面積の割合（0〜1） */
  text_area_ratio?: number;
  /** 手指・体の破綻（箇所の説明） */
  hand_anomalies?: string[];
  /** 構図: 主役の中心（0〜1）・画面占有率・中央 60% に収まっているか */
  composition?: { center_x?: number; center_y?: number; area_ratio?: number; in_center_60?: boolean };
  /** 動画のみ: 隣り合うコマの顔一致度の最大の変化量 */
  frame_max_delta?: number;
}

/** 計測サーバーに画像を送って数値にする。未設定・失敗は null（計測値なしで判定を続ける） */
export async function measureImage(cfg: MeasureConfig | null, input: { imageUrl: string; referenceUrl?: string | null; character: boolean }): Promise<QcMetrics | null> {
  if (!cfg) return null;
  try {
    return await requestJson<QcMetrics>("video_measure", `${cfg.url}/measure`, {
      method: "POST",
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
      json: { image_url: input.imageUrl, reference_url: input.referenceUrl ?? null, checks: [...(input.character ? ["face", "hands"] : []), "ocr", "composition"] },
    });
  } catch (e) {
    console.warn("[video-qc] 計測に失敗したため計測値なしで判定します:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type QcAction = "advance" | "retry" | "review" | "stop";

/** 判定後の処理（指示書 7-3）。確信度が無い判定は合格ライン未満として扱う */
export function qcNextAction(j: { result: QcResult | null; confidence: number | null }, opts: { threshold: number; retries: number; maxRetries: number }): QcAction {
  const sure = j.confidence !== null && j.confidence >= opts.threshold;
  if (j.result === "pass" && sure) return "advance";
  if (j.result === "retry" && sure) return opts.retries >= opts.maxRetries ? "stop" : "retry";
  return "review";
}

/** Claude の判定は最終判断（合格ライン未満でも従う）。作り直しの上限だけはここで見る */
export function reviewNextAction(result: QcResult, opts: { retries: number; maxRetries: number }): Exclude<QcAction, "review"> | "human" {
  if (result === "pass") return "advance";
  if (result === "retry") return opts.retries >= opts.maxRetries ? "stop" : "retry";
  return "human";
}

/** 計測値から明らかな不合格の理由を拾う（Jev・Claude への手がかり。合否はここで決めない） */
export function metricFlags(m: QcMetrics | null, limits: Pick<VideoLimits, "faceThreshold">): string[] {
  if (!m) return [];
  const flags: string[] = [];
  if (typeof m.face_similarity === "number" && m.face_similarity < limits.faceThreshold) flags.push(`顔の一致度が低い（${m.face_similarity.toFixed(2)} < ${limits.faceThreshold}）`);
  if (m.text_detected?.length || (m.text_area_ratio ?? 0) > 0.002) flags.push(`画面内に文字がある（${(m.text_detected ?? []).slice(0, 5).join(" / ") || "検出"}）`);
  if (m.hand_anomalies?.length) flags.push(`手指・体の破綻の疑い（${m.hand_anomalies.slice(0, 3).join(" / ")}）`);
  if (m.composition?.in_center_60 === false) flags.push("主役が画面中央 60% の範囲に収まっていない");
  if (typeof m.frame_max_delta === "number" && m.frame_max_delta > 0.25) flags.push(`コマの間で顔が大きく変わる（${m.frame_max_delta.toFixed(2)}）`);
  return flags;
}

export interface QcOutcome {
  result: QcResult;
  confidence: number | null;
  engine: "jev" | "claude" | "none";
  reason: QcReason | null;
  note: string | null;
  scores: Record<string, unknown>;
  action: Exclude<QcAction, "review"> | "human";
}

const REASONS: Record<QcReason, string> = {
  face_mismatch: "顔がキャラ設定書と一致しない",
  text_found: "画面内に文字・ロゴが入っている",
  hand_broken: "手指・体が破綻している",
  composition: "構図が指示と違う（主役の位置・大きさ）",
  other: "その他",
};

export function reasonLabel(r: QcReason | null): string {
  return r ? REASONS[r] : "";
}

/**
 * 1 枚の画像を検品する。subjectId は DecisionEvent に残す ID（人の判断と突き合わせる）。
 * phase: storyboard（絵コンテ）/ final（本番画像）/ video（動画から抜き出したコマ）
 */
export async function inspectImage(input: {
  avatarId: string;
  subjectId: string;
  phase: string;
  shot: Shot;
  /** このカットの自動の作り直しの回数（ジョブの入力） */
  retries: number;
  image: MediaRef;
  imageUrl: string;
  referenceUrl?: string | null;
  measure: MeasureConfig | null;
  limits: VideoLimits;
}): Promise<QcOutcome> {
  const { shot, limits } = input;
  const metrics = await measureImage(input.measure, { imageUrl: input.imageUrl, referenceUrl: input.referenceUrl, character: shot.visual.character });
  const flags = metricFlags(metrics, limits);
  const scores = { ...(metrics ?? {}), flags };
  const state = {
    phase: input.phase,
    shot: { description: shot.visual.description, composition: shot.visual.composition, character: shot.visual.character, expression: shot.visual.expression, checks: shot.checks },
    metrics: metrics ?? "計測値なし",
    metric_flags: flags,
    thresholds: { face_similarity_min: limits.faceThreshold, text_allowed: false, subject_within_center_60_percent: true },
  };
  const opts = { threshold: limits.qcThreshold, retries: input.retries, maxRetries: limits.maxRetries };

  const jev = await decideWithJev(
    { decisionType: "video_qc", avatarId: input.avatarId, subjectId: input.subjectId },
    state,
    {
      verdict: choice("Based on the shot instructions and the measured values, what should happen to this generated image?", {
        pass: "The image meets every check: the face matches, no text appears, hands and body are intact, and the composition follows the instruction.",
        retry: "The image clearly fails at least one check and should be regenerated.",
        hold: "The measurements are missing or ambiguous, so the image needs a visual review.",
      }),
      reason: choice("If the image should be regenerated, what is the main reason?", {
        face_mismatch: "The face does not match the character reference.",
        text_found: "Text, logos or watermarks appear in the image.",
        hand_broken: "Hands, fingers or the body are malformed.",
        composition: "The composition differs from the instruction (subject position or size).",
        other: "Some other problem, or no problem.",
      }),
    },
    (a) => topChoice(a.verdict)
  );
  if (jev && jev.mode === "gate") {
    const t = topChoice(jev.answers.verdict);
    const result = t.action as QcResult;
    const confidence = t.confidence ?? null;
    const action = qcNextAction({ result, confidence }, opts);
    if (action !== "review") {
      const reason = result === "retry" ? (jev.answers.reason.choice as QcReason) : null;
      return { result, confidence, engine: "jev", reason, note: reason ? reasonLabel(reason) : null, scores, action };
    }
  }

  // 精査（Claude 等の画像を読める AI）。Jev が保留・確信度不足・shadow のとき
  try {
    const bytes = await readMedia(input.image.name);
    const { data } = await completeJson<{ verdict: QcResult; reason: QcReason; confidence: number; note: string }>({
      task: "video_qc",
      system:
        "あなたは動画制作の検品担当です。生成された画像が、カットの指示とチェック項目を満たしているかを判定します。" +
        "顔の一致・文字の混入・手指の破綻・構図の 4 点を必ず見て、1 つでも明確に満たさなければ retry、判断できなければ hold にしてください。" +
        "note には作り直すときにプロンプトへ足すべき具体的な修正指示を日本語で 1〜2 文で書いてください（合格なら空）。",
      user: JSON.stringify({ ...state, instruction: "添付画像を判定してください" }, null, 2),
      images: [{ mimeType: input.image.mimeType, data: bytes.toString("base64") }],
      json: {
        name: "video_qc",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["verdict", "reason", "confidence", "note"],
          properties: {
            verdict: { type: "string", enum: ["pass", "retry", "hold"] },
            reason: { type: "string", enum: ["face_mismatch", "text_found", "hand_broken", "composition", "other"] },
            confidence: { type: "number" },
            note: { type: "string" },
          },
        },
      },
    });
    const result: QcResult = ["pass", "retry", "hold"].includes(data.verdict) ? data.verdict : "hold";
    const reason = result === "pass" ? null : (Object.keys(REASONS).includes(data.reason) ? data.reason : "other");
    const confidence = typeof data.confidence === "number" ? Math.max(0, Math.min(1, data.confidence)) : null;
    return { result, confidence, engine: "claude", reason, note: data.note?.trim() || (reason ? reasonLabel(reason) : null), scores, action: reviewNextAction(result, opts) };
  } catch (e) {
    // AI が使えない（キー未設定など）ときは判定しない。人が絵コンテ承認で見る
    if (!(e instanceof ConfigError)) console.warn("[video-qc] 精査に失敗しました:", e instanceof Error ? e.message : e);
    return { result: "hold", confidence: null, engine: "none", reason: null, note: `自動の検品ができませんでした（${e instanceof Error ? e.message.slice(0, 150) : String(e)}）`, scores, action: "human" };
  }
}
