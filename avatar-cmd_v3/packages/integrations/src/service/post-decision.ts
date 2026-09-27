// ================================================
// 投稿の可否判定（Jev） — 生成した投稿を公開してよいか
// ================================================
// Jev の答えをそのまま使わず、公開してよいかどうかはコードのポリシー（postGatePolicy）で決める。
// shadow モードでは記録だけ、gate モードでは自動投稿の前にポリシーを適用する。
// キーが無ければ null を返し、呼び出し側は既存の投稿前チェック（LLM）だけで動く。

import { choice, noul, score } from "@typesafe-ai/sdk";
import { prisma } from "@avatar-cmd/db";
import { getPlatform } from "../platforms";
import { readPersona } from "./ai";
import { decideWithJev, topChoice } from "./decision";

export interface PostJudgement {
  eventId: string;
  model: string;
  mode: "shadow" | "gate";
  action: "publish" | "review" | "hold";
  confidence?: number;
  /** 0〜2（弱い〜強い） */
  personaFit: number;
  /** 0〜2（低い〜高い） */
  salesPressure: number;
  /** 0〜1（過去投稿との重複の確率） */
  duplicateRisk: number;
  /** 0〜2（低い〜高い） */
  brandRisk: number;
}

/** 閾値はここ（コード）で管理する。Jev のプロンプトには入れない */
export const POST_GATE_THRESHOLDS = {
  minConfidence: 0.6,
  maxBrandRisk: 1.5,
  maxDuplicateRisk: 0.7,
  minPersonaFit: 0.5,
};

/** Jev の判定から「自動投稿してよいか」を決める。理由付きで返す */
export function postGatePolicy(j: Pick<PostJudgement, "action" | "confidence" | "brandRisk" | "duplicateRisk" | "personaFit">): { publish: boolean; reason: string } {
  const t = POST_GATE_THRESHOLDS;
  if (j.action === "hold") return { publish: false, reason: "Jev: 公開すべきでない（hold）" };
  if (j.action === "review") return { publish: false, reason: "Jev: 人の確認が必要（review）" };
  if (j.confidence !== undefined && j.confidence < t.minConfidence) return { publish: false, reason: `Jev: 確信度が低い（${Math.round(j.confidence * 100)}%）` };
  if (j.brandRisk >= t.maxBrandRisk) return { publish: false, reason: "Jev: ブランドリスクが高い" };
  if (j.duplicateRisk >= t.maxDuplicateRisk) return { publish: false, reason: "Jev: 最近の投稿と重複している可能性が高い" };
  if (j.personaFit < t.minPersonaFit) return { publish: false, reason: "Jev: アバターの口調・ルールに合っていない" };
  return { publish: true, reason: "Jev: 問題なし" };
}

export async function judgePost(input: { avatarId: string; platform: string; text: string; topic?: string; subjectId?: string }): Promise<PostJudgement | null> {
  const avatar = await prisma.avatar.findUnique({ where: { id: input.avatarId } });
  if (!avatar) return null;
  const persona = readPersona(avatar.communication);
  const recent = await prisma.content.findMany({
    where: { avatarId: input.avatarId, status: { in: ["PUBLISHED", "SCHEDULED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { content: true },
  });
  const state = {
    platform: getPlatform(input.platform)?.name ?? input.platform,
    topic: input.topic ?? null,
    draft: input.text,
    persona: {
      name: avatar.name,
      role: avatar.role,
      targetAudience: avatar.targetAudience,
      tone: persona.tone ?? null,
      rules: persona.prompt ?? null,
    },
    recentPosts: recent.map((r) => r.content.slice(0, 500)),
  };
  const d = await decideWithJev(
    { decisionType: "post_gate", avatarId: input.avatarId, subjectId: input.subjectId },
    state,
    {
      action: choice("What should happen to this draft before publication?", {
        publish: "The draft is suitable to publish as-is and has no meaningful issue requiring review.",
        review: "The draft is usable, but a human should review it first because of uncertainty, tone, repetition, or brand risk.",
        hold: "The draft should not be published because it has a substantial problem.",
      }),
      personaFit: score("How well does this draft match the supplied persona, tone, and rules?", ["Poor fit", "Acceptable fit", "Strong fit"]),
      salesPressure: score("How strong is the sales or promotional pressure in this draft?", ["Low", "Moderate", "High"]),
      duplicateRisk: noul("This draft substantially repeats the recent posts in topic, wording, or angle."),
      brandRisk: score("How much brand or reputational risk would publishing this draft create?", ["Low", "Moderate", "High"]),
    },
    (a) => topChoice(a.action)
  );
  if (!d) return null;
  const a = d.answers;
  return {
    eventId: d.eventId,
    model: d.model,
    mode: d.mode,
    action: a.action.choice,
    confidence: topChoice(a.action).confidence,
    personaFit: a.personaFit.score,
    salesPressure: a.salesPressure.score,
    duplicateRisk: a.duplicateRisk.noul,
    brandRisk: a.brandRisk.score,
  };
}

/** 判定の対象（投稿）が決まった後で紐付ける */
export async function linkDecision(eventId: string, subjectId: string) {
  await prisma.decisionEvent.update({ where: { id: eventId }, data: { subjectId } });
}
