// アバター入力の検証（作成・更新共通）
import { ConfigError } from "@avatar-cmd/integrations";
import { classifyAvatarGenre, setAvatarGenre } from "@avatar-cmd/integrations/server";

const STATUSES = ["ACTIVE", "PAUSED", "LEARNING", "ERROR"];

export function avatarData(b: Record<string, any>, creating: boolean) {
  const out: Record<string, unknown> = {};
  if (creating || b.name !== undefined) {
    if (!String(b.name ?? "").trim()) throw new ConfigError("名前を入力してください");
    out.name = String(b.name).trim().slice(0, 50);
  }
  for (const k of ["role", "description", "specialization", "targetAudience"]) {
    if (b[k] !== undefined) out[k] = String(b[k] ?? "").trim() || (k === "role" ? "sns_marketer" : null);
  }
  // クライアントのラベル（任意）。空なら付けない
  if (b.clientLabel !== undefined) out.clientLabel = String(b.clientLabel ?? "").trim().slice(0, 50) || null;
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw new ConfigError("ステータスが不正です");
    out.status = b.status;
  }
  if (b.persona !== undefined) {
    const p = b.persona ?? {};
    out.communication = {
      tone: String(p.tone ?? "").trim() || undefined,
      topics: (Array.isArray(p.topics) ? p.topics : String(p.topics ?? "").split(/[,、\n]/)).map((t: string) => String(t).trim()).filter(Boolean),
      postFrequency: String(p.postFrequency ?? "").trim() || undefined,
      bestTime: String(p.bestTime ?? "").trim() || undefined,
      prompt: String(p.prompt ?? "").trim() || undefined,
    };
  }
  return out;
}

/**
 * ジャンル: body.genre が GENRES のキーなら手動で設定、"auto" なら自動判定に戻す。
 * 指定が無ければ、プロフィールが変わったときだけ裏で判定し直す（AI の応答を待たずに保存を返す。worker も定期的に判定する）
 */
export async function applyGenre(id: string, genre: unknown) {
  if (genre === "auto") await setAvatarGenre(id, null);
  else if (typeof genre === "string" && genre) await setAvatarGenre(id, genre);
  else void classifyAvatarGenre(id).catch((e) => console.error("[genre]", (e as Error).message));
}
