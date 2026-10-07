// ================================================
// 判定レイヤー — TypeSafe Jev で「選択・スコア・可否」を確率付きで判定する
// ================================================
// ・Jev は生成には使わず、意味的に曖昧な判断（方向性の一致、リスク、改善か継続か等）にだけ使う。
//   数値の閾値・認証・スケジュールなど、コードで決められることはコードで決める。
// ・API キーは「設定 > システム > 判定（Jev）」で入力（暗号化して DB 保存）。未入力なら TYPESAFE_API_KEY。
// ・キーが無い / モードが off のときは Jev を呼ばず、呼び出し側は既存の流れ（LLM・コードのルール）で動く。
// ・モード:
//     shadow … 判定してログに残すだけ（処理は変えない）。人の判断との一致率を測る段階
//     gate   … 判定結果を処理に反映する（投稿を下書きに回す等）。反映ルールはコード側（policy）で決める
// ・判定はすべて DecisionEvent に記録し、人の最終判断（承認・却下）と突き合わせられるようにする。

import { TypeSafeClient, type Questions, type SystemOneResult } from "@typesafe-ai/sdk";
import { prisma } from "@avatar-cmd/db";
import { getSetting, mask, SETTING_KEYS } from "./store";
import { normalizeGenericUsage, recordUsage } from "./usage";

export type JevMode = "off" | "shadow" | "gate";
export const JEV_MODES: JevMode[] = ["off", "shadow", "gate"];
/** 本番では具体的なバージョンに固定する（jev-latest はモデルの変化を受け入れる場合のみ） */
export const DEFAULT_JEV_MODEL = "jev-1.13.0";

export interface JevConfig {
  apiKey: string;
  model: string;
  mode: Exclude<JevMode, "off">;
}

/** 使える状態なら設定を返す。キーが無い・off なら null（＝既存の流れで動かす） */
export async function jevConfig(): Promise<JevConfig | null> {
  const apiKey = (await getSetting(SETTING_KEYS.jevApiKey)) || process.env.TYPESAFE_API_KEY || "";
  if (!apiKey) return null;
  const rawMode = await getSetting(SETTING_KEYS.jevMode);
  const mode: JevMode = JEV_MODES.includes(rawMode as JevMode) ? (rawMode as JevMode) : "shadow";
  if (mode === "off") return null;
  const model = (await getSetting(SETTING_KEYS.jevModel)) || process.env.JEV_MODEL || DEFAULT_JEV_MODEL;
  return { apiKey, model, mode };
}

/** 設定画面用 */
export async function describeJev() {
  const saved = await getSetting(SETTING_KEYS.jevApiKey);
  const rawMode = await getSetting(SETTING_KEYS.jevMode);
  const since = new Date(Date.now() - 30 * 86400_000);
  const [total, errors, reviewed, agreed] = await Promise.all([
    prisma.decisionEvent.count({ where: { engine: "jev", createdAt: { gte: since } } }),
    prisma.decisionEvent.count({ where: { engine: "jev", createdAt: { gte: since }, error: { not: null } } }),
    prisma.decisionEvent.count({ where: { engine: "jev", createdAt: { gte: since }, humanAction: { not: null } } }),
    agreementCount(since),
  ]);
  return {
    apiKey: saved ? mask(saved) : "",
    fromEnv: !saved && !!process.env.TYPESAFE_API_KEY,
    model: (await getSetting(SETTING_KEYS.jevModel)) || process.env.JEV_MODEL || "",
    defaultModel: DEFAULT_JEV_MODEL,
    mode: (JEV_MODES.includes(rawMode as JevMode) ? rawMode : "shadow") as JevMode,
    stats: { total, errors, reviewed, agreed },
  };
}

/** 人の判断と Jev の判定が一致した件数（投稿の可否判定のみ: publish↔そのまま承認、hold/review↔却下・修正して承認） */
async function agreementCount(since: Date): Promise<number> {
  const rows = await prisma.decisionEvent.findMany({
    where: { engine: "jev", decisionType: "post_gate", createdAt: { gte: since }, humanAction: { not: null } },
    select: { selectedAction: true, humanAction: true },
  });
  // 修正して承認（approved_edited）は「そのままでは出せなかった」として review/hold と一致扱い
  return rows.filter((r) => (r.selectedAction === "publish") === (r.humanAction === "approved")).length;
}

// --- 呼び出し -------------------------------------------------------------------

export interface DecisionMeta {
  decisionType: "post_gate" | "quote_candidate" | "performance" | "improvement" | "video_qc";
  avatarId?: string | null;
  subjectId?: string | null;
}

export interface JevDecision<Q extends Questions> {
  eventId: string;
  model: string;
  mode: JevConfig["mode"];
  answers: SystemOneResult<Q>["answers"];
}

/** JSON に落とせる形にする（DB 保存用） */
function toJson(v: unknown): object {
  try {
    return JSON.parse(JSON.stringify(v ?? {}));
  } catch {
    return {};
  }
}

/**
 * Jev で判定し、DecisionEvent に記録する。
 * キー未設定・off のときは null。失敗しても例外にせず null を返す（呼び出し側は既存の流れで続行）。
 * summarize で answers から「選ばれた行動」と確信度を取り出してログに残す。
 */
export async function decideWithJev<const Q extends Questions>(
  meta: DecisionMeta,
  state: Record<string, unknown>,
  questions: Q,
  summarize: (answers: SystemOneResult<Q>["answers"]) => { action?: string; confidence?: number }
): Promise<JevDecision<Q> | null> {
  const cfg = await jevConfig();
  if (!cfg) return null;
  const started = Date.now();
  try {
    // タイムアウトは短め・リトライ1回（判定待ちで投稿処理全体が止まらないように）
    const client = new TypeSafeClient({ apiKey: cfg.apiKey, defaultModel: cfg.model, timeout: 20_000, retry: { maxRetries: 1 }, logLevel: "off" });
    const res = await client.systemOne({ model: cfg.model, state: toJson(state) as never, questions });
    const s = summarize(res.answers);
    const ev = await prisma.decisionEvent.create({
      data: {
        avatarId: meta.avatarId ?? null,
        decisionType: meta.decisionType,
        subjectId: meta.subjectId ?? null,
        engine: "jev",
        model: res.model || cfg.model,
        mode: cfg.mode,
        state: toJson(state),
        answers: toJson(res.answers),
        selectedAction: s.action ?? null,
        confidence: s.confidence ?? null,
        latencyMs: Date.now() - started,
        usage: toJson(res.usage),
      },
    });
    await recordUsage({ provider: "typesafe", model: res.model || cfg.model, purpose: `jev_${meta.decisionType}`, avatarId: meta.avatarId ?? undefined, ...normalizeGenericUsage(res.usage) });
    return { eventId: ev.id, model: res.model || cfg.model, mode: cfg.mode, answers: res.answers };
  } catch (e) {
    await prisma.decisionEvent.create({
      data: {
        avatarId: meta.avatarId ?? null,
        decisionType: meta.decisionType,
        subjectId: meta.subjectId ?? null,
        engine: "jev",
        model: cfg.model,
        mode: cfg.mode,
        state: toJson(state),
        latencyMs: Date.now() - started,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 1000),
      },
    });
    await recordUsage({ provider: "typesafe", model: cfg.model, purpose: `jev_${meta.decisionType}`, avatarId: meta.avatarId ?? undefined, error: e instanceof Error ? e.message : String(e) });
    console.warn("[jev] 判定に失敗したため既存の流れで続行します:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Jev 以外（LLM・コードのルール）の判定もログに残す（精度比較用） */
export async function logDecision(
  meta: DecisionMeta,
  d: { engine: "llm" | "rule"; model?: string; state: Record<string, unknown>; answers: unknown; action?: string; confidence?: number; applied?: boolean }
): Promise<string> {
  const ev = await prisma.decisionEvent.create({
    data: {
      avatarId: meta.avatarId ?? null,
      decisionType: meta.decisionType,
      subjectId: meta.subjectId ?? null,
      engine: d.engine,
      model: d.model ?? null,
      mode: "advisory",
      state: toJson(d.state),
      answers: toJson(d.answers),
      selectedAction: d.action ?? null,
      confidence: d.confidence ?? null,
      applied: d.applied ?? false,
    },
  });
  return ev.id;
}

export async function markApplied(eventId: string) {
  await prisma.decisionEvent.update({ where: { id: eventId }, data: { applied: true } });
}

/** 人の最終判断を記録する（下書きの承認・削除、引用候補の却下など） */
export async function recordHumanAction(subjectId: string, humanAction: string) {
  await prisma.decisionEvent.updateMany({ where: { subjectId, humanAction: null }, data: { humanAction } });
}

/** 確率が最も高い選択肢と確率（choice の confidence が無い場合の補完） */
export function topChoice(a: { choice: string; confidence?: number; probabilities?: Record<string, number> }) {
  return { action: a.choice, confidence: a.confidence ?? a.probabilities?.[a.choice] };
}
