import { choice, noul, score } from "@typesafe-ai/sdk";
import { getJevClient, getJevModel } from "./jev-client";
import type { PostDecisionInput, PostDecisionResult } from "./types";

function toJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Evaluate a generated social post with Jev.
 *
 * This is intentionally SHADOW MODE only:
 * - it never blocks publication
 * - it never changes the generated content
 * - it only returns structured decisions for logging/evaluation
 */
export async function evaluatePostDecision(
  input: PostDecisionInput
): Promise<PostDecisionResult> {
  const startedAt = Date.now();
  const client = getJevClient();

  if (!client) {
    return {
      available: false,
      mode: "shadow",
      durationMs: Date.now() - startedAt,
      skippedReason: "TYPESAFE_API_KEY is not configured",
    };
  }

  const model = getJevModel();

  try {
    const response = await client.systemOne({
      model,
      state: {
        platform: input.platform,
        topic: input.topic || null,
        draft: input.content,
        persona: input.soulContext.slice(0, 6000),
        recentPosts: (input.recentPosts || []).slice(0, 10),
        recentKnowledge: (input.recentKnowledge || []).slice(0, 5),
      },
      questions: {
        action: choice("What should happen to this draft before publication?", {
          publish:
            "The draft is suitable to publish as-is and has no meaningful issue requiring review.",
          review:
            "The draft is usable, but a human should review it before publication because of uncertainty, tone, repetition, or brand risk.",
          hold:
            "The draft should not be published yet because it has a substantial problem.",
        }),
        personaFit: score(
          "How well does this draft match the supplied persona, tone, and writing rules?",
          ["Poor fit", "Acceptable fit", "Strong fit"]
        ),
        salesPressure: score(
          "How strong is the sales or promotional pressure in this draft?",
          ["Low", "Moderate", "High"]
        ),
        duplicateRisk: noul(
          "This draft is substantially repetitive of the recent posts in topic, wording, or angle."
        ),
        brandRisk: score(
          "How much brand or reputational risk would publishing this draft create?",
          ["Low", "Moderate", "High"]
        ),
      },
    });

    const actionAnswer = response.answers.action;
    const personaFitAnswer = response.answers.personaFit;
    const salesPressureAnswer = response.answers.salesPressure;
    const duplicateRiskAnswer = response.answers.duplicateRisk;
    const brandRiskAnswer = response.answers.brandRisk;

    return {
      available: true,
      mode: "shadow",
      model: response.model || model,
      action: actionAnswer.choice,
      actionConfidence: actionAnswer.probabilities?.[actionAnswer.choice],
      personaFitScore: personaFitAnswer.score,
      salesPressureScore: salesPressureAnswer.score,
      duplicateRisk: duplicateRiskAnswer.noul,
      brandRiskScore: brandRiskAnswer.score,
      durationMs: Date.now() - startedAt,
      answers: toJsonRecord(response.answers),
      usage: toJsonRecord(response.usage),
    };
  } catch (error) {
    return {
      available: false,
      mode: "shadow",
      model,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
