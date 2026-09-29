// ================================================
// 引用投稿の候補 — タイムラインから方向性が同じ投稿を見つけ、肯定＋知見/体験を添えた引用案を下書きにする
// ================================================
// 流れ:
//   1. X のホームタイムライン（フォロー中の投稿）を取得（Owned Reads: 1件 $0.001）
//   2. コードのルールで除外（リポスト・返信・自分の投稿・短すぎる・古い・同じ相手を最近引用済み など）
//   3. 残りを判定: Jev（設定があれば）/ 無ければ「引用投稿」用途の LLM
//        方向性の一致・引用する価値・関わるリスク・添える観点（知見 / 体験）
//   4. 通過したものだけ引用文を生成 → 投稿前チェック → 下書き（承認必須。自動投稿はしない）
//   5. 承認すると quote_tweet_id 付きで投稿される
// 判定と人の判断（承認・却下）は DecisionEvent に記録し、精度を比べられるようにする。

import { choice, noul, score } from "@typesafe-ai/sdk";
import { prisma } from "@avatar-cmd/db";
import type { TimelinePost } from "../types";
import { getPlatform } from "../platforms";
import { ConfigError } from "../http";
import { loadFreshCredentials } from "./accounts";
import { buildPrompts, readPersona, reviewPost } from "./ai";
import { decideWithJev, logDecision, topChoice } from "./decision";
import { completeJson, completeText } from "./llm";
import { errorMessage } from "./publish";
import { cleanPostText } from "../post-text";
import { getSystemConfig } from "./store";

const HOUR = 3600_000;

/** 除外ルールと上限（コードで管理） */
export const QUOTE_RULES = {
  minLength: 40,
  maxAgeHours: 48,
  sameAuthorCooldownDays: 7,
  /** 1回の探索で判定にかける最大件数（判定コストの上限） */
  maxJudged: 10,
  /** 1回の探索で作る下書きの最大件数 */
  maxDrafts: 3,
  /** 判定を通す条件 */
  minAligned: 0.6,
  minWorth: 0.6,
  maxRisk: 1.0,
};

export type Direction = "aligned" | "partial" | "opposed" | "unrelated";
export type Angle = "knowledge" | "experience";

export interface QuoteJudgement {
  direction: Direction;
  alignedProb: number;
  worth: number;
  /** 0〜2（低い〜高い） */
  risk: number;
  angle: Angle;
  reason?: string;
  engine: "jev" | "llm";
  eventId: string;
}

/** 判定から「引用案を作るか」を決める */
export function quotePolicy(j: Pick<QuoteJudgement, "direction" | "alignedProb" | "worth" | "risk">): { pass: boolean; reason: string } {
  const r = QUOTE_RULES;
  if (j.direction !== "aligned" || j.alignedProb < r.minAligned) return { pass: false, reason: `方向性が一致しない（${j.direction}）` };
  if (j.worth < r.minWorth) return { pass: false, reason: "引用して付け加える価値が小さい" };
  if (j.risk > r.maxRisk) return { pass: false, reason: "関わるリスクが高い" };
  return { pass: true, reason: "方向性が一致・付加価値あり" };
}

/** コードのルールで除外する理由（除外しないなら null） */
export function ruleOutReason(p: TimelinePost, ctx: { selfId: string; now: Date; recentAuthors: Set<string> }): string | null {
  const r = QUOTE_RULES;
  if (p.kind !== "original") return p.kind === "repost" ? "リポスト" : p.kind === "reply" ? "返信" : "引用投稿";
  if (p.authorId && p.authorId === ctx.selfId) return "自分の投稿";
  const body = p.text.replace(/https?:\/\/\S+/g, "").trim();
  if ([...body].length < r.minLength) return "短すぎる（リンクのみ等）";
  if (p.createdAt && ctx.now.getTime() - Date.parse(p.createdAt) > r.maxAgeHours * HOUR) return "古い投稿";
  if (p.authorId && ctx.recentAuthors.has(p.authorId)) return `同じ相手を${r.sameAuthorCooldownDays}日以内に引用済み`;
  return null;
}

async function personaState(avatarId: string) {
  const avatar = await prisma.avatar.findUniqueOrThrow({ where: { id: avatarId } });
  const persona = readPersona(avatar.communication);
  return {
    avatar,
    persona,
    summary: {
      name: avatar.name,
      role: avatar.role,
      specialization: avatar.specialization,
      targetAudience: avatar.targetAudience,
      description: avatar.description,
      tone: persona.tone ?? null,
      topics: persona.topics ?? [],
      rules: persona.prompt ?? null,
    },
  };
}

const LLM_SCHEMA = {
  type: "object",
  properties: {
    direction: { type: "string", enum: ["aligned", "partial", "opposed", "unrelated"] },
    worth: { type: "number" },
    risk: { type: "string", enum: ["low", "moderate", "high"] },
    angle: { type: "string", enum: ["knowledge", "experience"] },
    reason: { type: "string" },
  },
  required: ["direction", "worth", "risk", "angle", "reason"],
  additionalProperties: false,
};

/** 引用候補を判定する（Jev があれば Jev、無ければ LLM） */
export async function judgeQuoteCandidate(input: { avatarId: string; candidateId: string; post: TimelinePost; persona: Record<string, unknown> }): Promise<QuoteJudgement> {
  const state = {
    avatar: input.persona,
    post: { author: input.post.authorUsername ? `@${input.post.authorUsername}` : null, text: input.post.text, metrics: input.post.metrics ?? {} },
  };
  const meta = { decisionType: "quote_candidate" as const, avatarId: input.avatarId, subjectId: input.candidateId };
  const jev = await decideWithJev(
    meta,
    state,
    {
      direction: choice("Does this post's stance and message point in the same direction as the avatar's viewpoint and themes?", {
        aligned: "Same direction: the avatar can sincerely agree with the main claim.",
        partial: "Partly overlapping, but the avatar would need to disagree with or qualify part of it.",
        opposed: "The avatar's viewpoint contradicts the post.",
        unrelated: "The post is unrelated to the avatar's themes.",
      }),
      worth: noul("Quoting this post with agreement and adding the avatar's own knowledge or experience would give genuine value to the avatar's audience."),
      risk: score("How much reputational risk comes from associating with this post or its author (controversy, misinformation, sensitive or political topics, harassment)?", ["Low", "Moderate", "High"]),
      angle: choice("Which addition would fit best when quoting this post?", {
        knowledge: "Add a fact, tip, or insight from the avatar's expertise.",
        experience: "Add a short first-hand experience that the avatar's profile supports.",
      }),
    },
    (a) => topChoice(a.direction)
  );
  if (jev) {
    const a = jev.answers;
    return {
      direction: a.direction.choice,
      alignedProb: a.direction.probabilities.aligned ?? (a.direction.choice === "aligned" ? topChoice(a.direction).confidence ?? 1 : 0),
      worth: a.worth.noul,
      risk: a.risk.score,
      angle: a.angle.choice,
      engine: "jev",
      eventId: jev.eventId,
    };
  }
  // Jev が無い場合は「引用投稿」用途の LLM で判定（既存の流れ）
  const system = [
    "あなたは SNS 運用の編集者です。タイムラインの投稿を、アバターが肯定的に引用してよいかを判定します。",
    "direction: aligned=アバターが本心から同意できる / partial=一部だけ同意 / opposed=反対 / unrelated=無関係",
    "worth: 肯定して知見や体験を添えることが読者に価値を生む確率（0〜1）",
    "risk: 投稿や投稿者と関わることの評判リスク（炎上・誤情報・政治・センシティブ・誹謗中傷）",
    "angle: 添えるなら knowledge（専門知識・コツ）か experience（プロフィールに裏付けのある体験）か",
    "reason: 日本語で1文",
  ].join("\n");
  const { data, model } = await completeJson<{ direction: Direction; worth: number; risk: "low" | "moderate" | "high"; angle: Angle; reason: string }>({
    task: "quote",
    system,
    user: JSON.stringify(state),
    json: { name: "quote_judgement", schema: LLM_SCHEMA },
  });
  const risk = { low: 0, moderate: 1, high: 2 }[data.risk] ?? 2;
  const worth = Math.max(0, Math.min(1, Number(data.worth) || 0));
  const eventId = await logDecision(meta, { engine: "llm", model, state, answers: data, action: data.direction });
  return { direction: data.direction, alignedProb: data.direction === "aligned" ? 1 : 0, worth, risk, angle: data.angle === "experience" ? "experience" : "knowledge", reason: data.reason, engine: "llm", eventId };
}

/** 肯定＋知見/体験を添えた引用文を生成する */
export async function writeQuoteText(input: { avatarId: string; platform: string; post: TimelinePost; angle: Angle }) {
  const avatar = await prisma.avatar.findUniqueOrThrow({ where: { id: input.avatarId } });
  const knowledge = await prisma.knowledgeItem.findMany({
    where: { avatarId: avatar.id, isActive: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { title: true, summary: true },
  });
  const { system, limit } = buildPrompts(avatar, readPersona(avatar.communication), { topic: "", platform: input.platform }, knowledge);
  const user = [
    `次の投稿（${input.post.authorUsername ? `@${input.post.authorUsername}` : "フォロー中の投稿"}）を引用して、あなたの投稿を1件書いてください。`,
    "・最初に投稿の主張に共感・肯定していることが伝わるようにする（「同意」「わかる」だけで終わらない）",
    input.angle === "experience"
      ? "・あなた自身の体験を1つ添える。体験はプロフィール・知識に書かれている事実に基づくこと。書かれていない体験を作らない。根拠が無ければ知見を添える"
      : "・あなたの専門知識から、具体的な知見・コツ・補足を1つ添える",
    "・引用元の内容を言い換えて繰り返さない。相手を持ち上げすぎない。宣伝や自分への誘導はしない",
    "・引用元の URL・メンション・ハッシュタグは付けない（引用として表示されるため）",
    limit && `・${limit}文字以内`,
    "",
    "--- 引用する投稿 ---",
    input.post.text,
  ]
    .filter(Boolean)
    .join("\n");
  const res = await completeText({ task: "quote", system, user });
  let text = cleanPostText(res.text);
  if (limit && [...text].length > limit) text = [...text].slice(0, limit - 1).join("") + "…";
  return { text, model: res.model };
}

/** 数値文字列の ID を大小比較する（桁数が多いほど大きい） */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

export interface ScanResult {
  fetched: number;
  new: number;
  skipped: number;
  judged: number;
  drafted: number;
  errors: string[];
}

/** X アカウントのホームタイムラインから引用候補を探し、通過したものを下書きにする */
export async function scanQuoteCandidates(snsAccountId: string, opts: { maxResults?: number } = {}): Promise<ScanResult> {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: snsAccountId } });
  const def = getPlatform(acc.platform);
  if (!def?.fetchTimeline || !def.supportsQuote) throw new ConfigError(`${def?.name ?? acc.platform} はタイムラインからの引用候補に対応していません`);
  if (!acc.isActive) throw new ConfigError("停止中のアカウントです");
  const settings = (acc.settings ?? {}) as Record<string, unknown>;
  const maxResults = opts.maxResults ?? (Number(settings.quoteScanPosts) || 30);

  // 前回読んだ中で最も新しい投稿 ID から続きを取る（X の ID は時系列で増える数値）
  const sinceId = typeof settings.quoteSinceId === "string" ? settings.quoteSinceId : undefined;
  const { credentials, app } = await loadFreshCredentials(acc.id);
  const system = await getSystemConfig();
  const timeline = await def.fetchTimeline(
    { app, credentials, settings, account: { accountId: acc.accountId ?? "", accountName: acc.accountName }, system },
    { maxResults, sinceId }
  );
  const newest = [sinceId, ...timeline.map((p) => p.id)].filter((x): x is string => !!x).sort(compareIds).at(-1);
  await prisma.snsAccount.update({
    where: { id: acc.id },
    data: { settings: { ...settings, lastQuoteScanAt: new Date().toISOString(), ...(newest ? { quoteSinceId: newest } : {}) } as object },
  });

  const result: ScanResult = { fetched: timeline.length, new: 0, skipped: 0, judged: 0, drafted: 0, errors: [] };
  const now = new Date();
  const since = new Date(now.getTime() - QUOTE_RULES.sameAuthorCooldownDays * 24 * HOUR);
  const recent = await prisma.quoteCandidate.findMany({
    where: { avatarId: acc.avatarId, status: { in: ["drafted", "approved", "published"] }, updatedAt: { gte: since }, authorId: { not: null } },
    select: { authorId: true },
  });
  const recentAuthors = new Set(recent.map((r) => r.authorId!));

  // 新しい投稿だけを保存し、除外ルールを適用
  const fresh: { id: string; post: TimelinePost }[] = [];
  for (const p of timeline) {
    const exists = await prisma.quoteCandidate.findUnique({ where: { avatarId_platform_externalPostId: { avatarId: acc.avatarId, platform: acc.platform, externalPostId: p.id } } });
    if (exists) continue;
    result.new++;
    const out = ruleOutReason(p, { selfId: acc.accountId ?? "", now, recentAuthors });
    const row = await prisma.quoteCandidate.create({
      data: {
        avatarId: acc.avatarId,
        snsAccountId: acc.id,
        platform: acc.platform,
        externalPostId: p.id,
        authorId: p.authorId ?? null,
        authorUsername: p.authorUsername ?? null,
        text: p.text,
        url: p.url,
        postedAt: p.createdAt ? new Date(p.createdAt) : null,
        metrics: (p.metrics ?? {}) as object,
        status: out ? "skipped" : "pending",
        reason: out,
      },
    });
    if (out) result.skipped++;
    else fresh.push({ id: row.id, post: p });
  }

  // 反応の大きい順に上限件数まで判定（判定コストの上限）
  const reach = (p: TimelinePost) => (p.metrics?.likes ?? 0) + 2 * (p.metrics?.reposts ?? 0) + (p.metrics?.replies ?? 0);
  fresh.sort((a, b) => reach(b.post) - reach(a.post));
  const toJudge = fresh.slice(0, QUOTE_RULES.maxJudged);
  for (const f of fresh.slice(QUOTE_RULES.maxJudged)) {
    await prisma.quoteCandidate.update({ where: { id: f.id }, data: { status: "skipped", reason: "判定件数の上限を超えたため未判定" } });
    result.skipped++;
  }

  const { summary } = await personaState(acc.avatarId);
  for (const f of toJudge) {
    try {
      const j = await judgeQuoteCandidate({ avatarId: acc.avatarId, candidateId: f.id, post: f.post, persona: summary });
      result.judged++;
      const policy = quotePolicy(j);
      if (!policy.pass || result.drafted >= QUOTE_RULES.maxDrafts) {
        await prisma.quoteCandidate.update({
          where: { id: f.id },
          data: { status: "skipped", reason: policy.pass ? "下書き件数の上限" : `${policy.reason}${j.reason ? `: ${j.reason}` : ""}`, angle: j.angle },
        });
        result.skipped++;
        continue;
      }
      const { text, model } = await writeQuoteText({ avatarId: acc.avatarId, platform: acc.platform, post: f.post, angle: j.angle });
      let review: { verdict: string; summary: string; model?: string; error?: string };
      try {
        const r = await reviewPost({ text, avatarId: acc.avatarId, platform: acc.platform });
        review = { verdict: r.verdict, summary: r.summary, model: r.model };
      } catch (e) {
        review = { verdict: "error", summary: "", error: errorMessage(e) };
      }
      const content = await prisma.content.create({
        data: {
          avatarId: acc.avatarId,
          platform: acc.platform,
          snsAccountId: acc.id,
          content: text,
          status: "DRAFT",
          category: "quote",
          metadata: {
            media: [],
            options: {},
            model,
            review,
            quote: { postId: f.post.id, url: f.post.url, authorUsername: f.post.authorUsername, text: f.post.text.slice(0, 500), candidateId: f.id },
            quoteJudgement: { engine: j.engine, direction: j.direction, worth: j.worth, risk: j.risk, angle: j.angle, reason: j.reason ?? policy.reason },
          } as object,
        },
      });
      await prisma.quoteCandidate.update({ where: { id: f.id }, data: { status: "drafted", reason: j.reason ?? policy.reason, angle: j.angle, contentId: content.id } });
      if (f.post.authorId) recentAuthors.add(f.post.authorId);
      result.drafted++;
    } catch (e) {
      const msg = errorMessage(e).slice(0, 300);
      result.errors.push(msg);
      await prisma.quoteCandidate.update({ where: { id: f.id }, data: { status: "skipped", reason: `判定・生成に失敗: ${msg}` } });
      result.skipped++;
    }
  }

  await prisma.activityLog.create({
    data: {
      avatarId: acc.avatarId,
      action: "quote_scan",
      category: "content",
      level: result.errors.length ? "warning" : "success",
      description: `${def.name} (${acc.accountName}) のタイムライン ${result.fetched} 件から引用候補を探索: 新規 ${result.new} 件・判定 ${result.judged} 件・下書き ${result.drafted} 件`,
      metadata: { accountId: acc.id, ...result } as object,
    },
  });
  return result;
}

/** 自動探索が有効なアカウントを探索する（worker から呼ぶ） */
export async function processQuoteScans(): Promise<number> {
  const accounts = await prisma.snsAccount.findMany({ where: { platform: "x", isActive: true, avatar: { status: "ACTIVE" } } });
  let n = 0;
  for (const acc of accounts) {
    const s = (acc.settings ?? {}) as Record<string, unknown>;
    const hours = Number(s.quoteScanHours);
    if (!hours) continue;
    const last = typeof s.lastQuoteScanAt === "string" ? Date.parse(s.lastQuoteScanAt) : 0;
    if (Date.now() - last < hours * HOUR) continue;
    try {
      await scanQuoteCandidates(acc.id);
      n++;
    } catch (e) {
      // 失敗しても次回まで待つ（課金が発生する処理を短い間隔で繰り返さない）
      await prisma.snsAccount.update({ where: { id: acc.id }, data: { settings: { ...s, lastQuoteScanAt: new Date().toISOString() } as object, lastError: errorMessage(e).slice(0, 300) } });
    }
  }
  return n;
}

/** 画面表示用: 最近の引用候補 */
export async function listQuoteCandidates(avatarId?: string, take = 30) {
  return prisma.quoteCandidate.findMany({
    where: avatarId ? { avatarId } : {},
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, avatarId: true, platform: true, authorUsername: true, text: true, url: true, postedAt: true, status: true, reason: true, angle: true, contentId: true, createdAt: true },
  });
}
