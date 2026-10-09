// ================================================
// 動画パイプライン — ジョブ（1 エピソード × 1 工程 × 1 カット）と各工程の実行
// ================================================
// ・ジョブは worker が数秒ごとに取り出して実行する（processVideoJobs）。worker が止まっているときは web で実行する。
// ・同じ入力のジョブは二重に走らせない（inputHash で判定。作り直しは理由・回数が入力に入るので別のジョブになる）。
// ・各ジョブは開始前にエピソードの状態と費用を確かめ、前の工程が終わっていない・止まっているときは何もしない。
// ・1 本あたりの費用が上限を超えたら全工程を一時停止し、内訳を添えて人に報告する。
// ・安全フィルタで断られた生成は言い換えて回避しない。カットを止めて内容の見直しを人に提案する。

import { createHash } from "crypto";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { ApiError, ConfigError } from "../http";
import { readPersona } from "./ai";
import { generateImage, type ImageRequest } from "./image-gen";
import { completeJson, completeText, resolveAi, type InputImage } from "./llm";
import { readMedia, saveMedia, type MediaRef } from "./media";
import { getSetting, getSystemConfig, SETTING_KEYS } from "./store";
import { withUsageContext } from "./usage";
import { assertPublicUrl } from "./web-extract";
import { fishConfig, getVideoAssets, getVideoImageSettings, getVideoLimits, measureConfig } from "./video-config";
import { episodeCost, mutateShotlist, overBudget, readShotlist, reportToHuman, saveShotlist, updateShot, type EpisodeRow } from "./video-episode";
import { VIDEO_PROFILES, type VideoProfileId } from "./video-profiles";
import { inspectImage, reasonLabel, type QcOutcome } from "./video-qc";
import { alignShots, assignPseudoMotions, buildCues, EPISODE_FORMATS, estimateSeconds, normalizeShotlist, patchShot, shotImagePrompt, toSrt, type ShotTiming } from "./video-shotlist";
import { applyReadingDict, CHAPTER_GAP_SEC, scriptMatchRate, synthesize, transcribe } from "./video-tts";
import { klingConfig, runI2v } from "./video-i2v";

/** i2v = 動画化（Kling の image-to-video。1 カットずつ） */
export type VideoJobStep = "topics" | "script" | "narration" | "storyboard" | "final" | "i2v" | "thumbnails";
const STEPS: VideoJobStep[] = ["topics", "script", "narration", "storyboard", "final", "i2v", "thumbnails"];

const CONCURRENCY = Number(process.env.VIDEO_JOB_CONCURRENCY || 2);
const STALE_MS = 30 * 60_000;
const WORKER_ALIVE_MS = 90_000;
/** 一時的なエラー（タイムアウト・レート制限・サーバーエラー）の再試行回数 */
const TRANSIENT_RETRIES = 3;

const running = new Set<string>();

export function jobHash(episodeId: string, step: string, shotId: string | null, input: unknown): string {
  return createHash("sha256").update(JSON.stringify([episodeId, step, shotId, input ?? {}])).digest("hex");
}

async function workerAlive(): Promise<boolean> {
  const beat = await getSetting(SETTING_KEYS.workerHeartbeat);
  return !!beat && Date.now() - new Date(beat).getTime() < WORKER_ALIVE_MS;
}

/** ジョブを依頼する。同じ入力のジョブがあればそれを返す（二重実行しない） */
export async function enqueueVideoJob(episodeId: string, step: VideoJobStep, shotId: string | null = null, input: Record<string, unknown> = {}) {
  if (!STEPS.includes(step)) throw new ConfigError(`不明な工程です: ${step}`);
  const inputHash = jobHash(episodeId, step, shotId, input);
  const existing = await prisma.videoJob.findUnique({ where: { inputHash } });
  if (existing) return existing;
  const job = await prisma.videoJob.create({ data: { episodeId, step, shotId, inputHash, input: input as Prisma.InputJsonValue } }).catch(async (e) => {
    // 同時に依頼された場合（一意制約）は先に作られた方を使う
    const again = await prisma.videoJob.findUnique({ where: { inputHash } });
    if (again) return again;
    throw e;
  });
  if (!(await workerAlive())) void runVideoJob(job.id);
  return job;
}

/** 1 件実行する */
export async function runVideoJob(id: string): Promise<boolean> {
  if (running.has(id)) return false;
  const claimed = await prisma.videoJob.updateMany({ where: { id, status: "queued" }, data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } } });
  if (!claimed.count) return false;
  running.add(id);
  try {
    const job = await prisma.videoJob.findUniqueOrThrow({ where: { id } });
    const ep = await prisma.videoEpisode.findUniqueOrThrow({ where: { id: job.episodeId } });
    if (ep.status !== "active") {
      await prisma.videoJob.update({ where: { id }, data: { status: "failed", error: `エピソードが ${ep.status === "paused" ? "一時停止中" : "終了"} のため実行しませんでした`, finishedAt: new Date() } });
      return true;
    }
    const limits = await getVideoLimits();
    const cost = await episodeCost(ep.id);
    if (overBudget(cost.amounts, limits.episodeBudget, limits.currency)) {
      await reportToHuman(
        ep,
        {
          what: `1 本あたりの費用上限（${limits.episodeBudget} ${limits.currency}）に達したため全工程を一時停止しました`,
          where: `${ep.episodeKey}（${job.step}${job.shotId ? ` / ${job.shotId}` : ""}）`,
          tried: `ここまでの費用: ${Object.entries(cost.amounts).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(" / ")}（API 呼び出し ${cost.calls} 回）`,
          choices: ["上限を引き上げて再開する", "i2v のカットを pseudo に切り替えて費用を抑える", "このエピソードを中止する"],
        },
        { pause: true, level: "error" }
      );
      await prisma.videoJob.update({ where: { id }, data: { status: "failed", error: "費用上限のため一時停止", finishedAt: new Date() } });
      return true;
    }
    const progress = (text: string) => prisma.videoJob.update({ where: { id }, data: { progress: text } }).catch(() => undefined);
    let result: unknown = null;
    await withUsageContext({ context: "video", subjectId: ep.id, avatarId: ep.avatarId }, async () => {
      result = await withTransientRetry(() => runStep(job.step as VideoJobStep, ep, job.shotId, (job.input ?? {}) as Record<string, unknown>, progress));
    });
    await prisma.videoJob.update({ where: { id }, data: { status: "done", result: (result ?? null) as Prisma.InputJsonValue, finishedAt: new Date() } });
    // 自分を done にしてから「工程の全カットが終わったか」を見る（同時に終わったジョブのどれかが必ず次へ進める）
    if (job.step === "storyboard" || job.step === "final") await maybeFinishImageStage(ep.id, job.step);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.videoJob.update({ where: { id }, data: { status: "failed", error: msg.slice(0, 2000), finishedAt: new Date() } }).catch(() => undefined);
    const job = await prisma.videoJob.findUnique({ where: { id }, include: { episode: true } });
    if (job) {
      await reportToHuman(job.episode, {
        what: isSafetyRefusal(e) ? "安全フィルタで生成を断られました（言い換えての回避はしません）" : e instanceof ConfigError ? "入力・設定の不備で止まりました" : "処理が失敗しました",
        where: `${job.episode.episodeKey}（${job.step}${job.shotId ? ` / ${job.shotId}` : ""}）`,
        tried: msg.slice(0, 400),
        choices: isSafetyRefusal(e) ? ["カットの内容（描写）を見直して作り直す", "このカットを資料風（document）・static に変える"] : ["設定を直してから再実行する", "この工程を手作業で行い、ファイルをアップロードする"],
      });
    }
  } finally {
    running.delete(id);
  }
  return true;
}

function isTransient(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 408 || e.status === 429 || e.status >= 500;
  const msg = e instanceof Error ? e.message : String(e);
  return /timeout|timed out|ETIMEDOUT|ECONNRESET|接続できません|overloaded/i.test(msg);
}

function isSafetyRefusal(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /断りました|SAFETY|PROHIBITED|blocked|content[_ ]policy|moderation|refus/i.test(msg);
}

/** 一時的なエラーは待ち時間を倍にしながら 3 回まで再試行する（入力の不備・安全フィルタは再試行しない） */
async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  let wait = Number(process.env.VIDEO_RETRY_BASE_MS || 2000);
  for (let i = 0; ; i++) {
    try {
      return await withUsageContext({ isRetry: i > 0 }, fn);
    } catch (e) {
      if (i >= TRANSIENT_RETRIES || !isTransient(e) || isSafetyRefusal(e)) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

/** 待っているジョブを取り出して始める（worker から数秒ごとに呼ぶ） */
export async function processVideoJobs(): Promise<number> {
  await prisma.videoJob.updateMany({
    where: { status: "running", updatedAt: { lt: new Date(Date.now() - STALE_MS) }, id: { notIn: [...running] } },
    data: { status: "failed", error: "処理が中断されました（サーバーの再起動など）。画面から再実行してください", finishedAt: new Date() },
  });
  const free = CONCURRENCY - running.size;
  if (free <= 0) return 0;
  const queued = await prisma.videoJob.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: free, select: { id: true } });
  for (const q of queued) void runVideoJob(q.id);
  return queued.length;
}

// --- 各工程 -------------------------------------------------------------------------

type Progress = (text: string) => Promise<unknown>;

async function runStep(step: VideoJobStep, ep: EpisodeRow, shotId: string | null, input: Record<string, unknown>, progress: Progress): Promise<unknown> {
  switch (step) {
    case "topics":
      return stepTopics(ep, input);
    case "script":
      return stepScript(ep, input);
    case "narration":
      return stepNarration(ep, progress);
    case "storyboard":
    case "final":
      if (!shotId) throw new Error("カットが指定されていません");
      return stepImage(step, ep, shotId, input);
    case "i2v":
      if (!shotId) throw new Error("カットが指定されていません");
      return stepI2v(ep, shotId, input, progress);
    case "thumbnails":
      return stepThumbnails(ep, input);
  }
}

/** 工程を進める（今の工程が from のときだけ。同時に終わったジョブが二重に進めないように） */
async function advanceStage(episodeId: string, from: string, to: string, data: Prisma.VideoEpisodeUpdateManyMutationInput = {}): Promise<boolean> {
  const r = await prisma.videoEpisode.updateMany({ where: { id: episodeId, stage: from }, data: { ...data, stage: to } });
  return r.count > 0;
}

async function avatarBrief(avatarId: string): Promise<string> {
  const a = await prisma.avatar.findUniqueOrThrow({ where: { id: avatarId } });
  const p = readPersona(a.communication);
  return [
    `語り手: ${a.name}（${a.role}）`,
    a.specialization && `専門: ${a.specialization}`,
    a.targetAudience && `想定視聴者: ${a.targetAudience}`,
    p.tone && `口調: ${p.tone}`,
    p.prompt && `守るべきルール: ${p.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// 1. ネタ候補 -------------------------------------------------------------------------

export interface TopicCandidate {
  title: string;
  angle: string;
  sources: { label: string; url: string; ok?: boolean }[];
}

/** 一次情報 URL が開けるか（公開 URL で 400 未満）。確認できないものは ok: false（人が承認 A で見る） */
async function checkUrl(url: string): Promise<boolean> {
  try {
    await assertPublicUrl(url);
    const ctl = AbortSignal.timeout(8000);
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctl });
    if (res.status === 405 || res.status === 403) res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
    return res.status < 400;
  } catch {
    return false;
  }
}

export function parseTopics(text: string): TopicCandidate[] {
  const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  let data: any;
  try {
    data = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch {
    const obj = JSON.parse(raw);
    data = obj.topics;
  }
  if (!Array.isArray(data)) data = data?.topics ?? [];
  return (data as any[])
    .map((t) => ({
      title: String(t?.title ?? "").trim().slice(0, 200),
      angle: String(t?.angle ?? "").trim().slice(0, 500),
      sources: (Array.isArray(t?.sources) ? t.sources : [])
        .map((s: any) => ({ label: String(s?.label ?? "").slice(0, 200), url: String(s?.url ?? "").trim() }))
        .filter((s: { url: string }) => /^https?:\/\//.test(s.url))
        .slice(0, 5),
    }))
    .filter((t) => t.title)
    .slice(0, 10);
}

async function stepTopics(ep: EpisodeRow, input: Record<string, unknown>) {
  const recent = await prisma.videoEpisode.findMany({ where: { avatarId: ep.avatarId, id: { not: ep.id }, title: { not: "" } }, orderBy: { createdAt: "desc" }, take: 10, select: { title: true } });
  const r = await resolveAi("video_topics");
  const search = r.provider === "gemini";
  const system = [
    "あなたは YouTube チャンネルのリサーチ担当です。動画のネタ候補を 10 件出します。",
    "各候補には、事実の裏付けになる一次情報（公的機関・報道・論文・当事者の発表など）の URL を必ず 1 件以上付けてください。URL は実在するものだけを書き、推測で作らないでください。",
    "各候補に、この語り手ならではの切り口を 1 行で付けてください。",
    "実在の事件・被害者を扱う場合は、被害者や遺族を傷つける切り口にしないでください。",
    '出力は JSON 配列のみ: [{"title": "...", "angle": "...", "sources": [{"label": "...", "url": "https://..."}]}]',
  ].join("\n");
  const user = [
    await avatarBrief(ep.avatarId),
    `ジャンル・テーマ: ${ep.theme || "（指定なし）"}`,
    recent.length ? `最近扱ったネタ（重複させない）: ${recent.map((x) => x.title).join(" / ")}` : "",
    typeof input.feedback === "string" && input.feedback ? `追加の指示: ${input.feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  let topics: TopicCandidate[];
  if (search) {
    const res = await completeText({ task: "video_topics", system, user, search: true });
    topics = parseTopics(res.text);
  } else {
    const res = await completeJson<{ topics: TopicCandidate[] }>({
      task: "video_topics",
      system,
      user,
      json: {
        name: "topics",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["topics"],
          properties: {
            topics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "angle", "sources"],
                properties: {
                  title: { type: "string" },
                  angle: { type: "string" },
                  sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "url"], properties: { label: { type: "string" }, url: { type: "string" } } } },
                },
              },
            },
          },
        },
      },
    });
    topics = parseTopics(JSON.stringify(res.data.topics ?? []));
  }
  if (!topics.length) throw new Error("ネタ候補を作れませんでした（AI の応答が空でした）");
  for (const t of topics) for (const s of t.sources) s.ok = await checkUrl(s.url);
  await prisma.videoEpisode.update({ where: { id: ep.id }, data: { topics: topics as unknown as Prisma.InputJsonValue } });
  await advanceStage(ep.id, "topics", "approve_topic");
  return { count: topics.length, grounded: search };
}

// 3. 台本とカット指示書 -------------------------------------------------------------------

const SHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shot_id", "chapter_id", "narration", "visual", "motion_type", "motion_note", "short_candidate", "subtitle_emphasis", "bgm_mood", "checks"],
  properties: {
    shot_id: { type: "string" },
    chapter_id: { type: "string" },
    narration: { type: "string" },
    visual: {
      type: "object",
      additionalProperties: false,
      required: ["description", "composition", "character", "expression", "style", "realistic"],
      properties: {
        description: { type: "string" },
        composition: { type: "string" },
        character: { type: "boolean" },
        expression: { type: "string" },
        style: { type: "string", enum: ["illustration", "anime", "document"] },
        realistic: { type: "boolean" },
      },
    },
    motion_type: { type: "string", enum: ["i2v", "pseudo", "static"] },
    motion_note: { type: "string" },
    short_candidate: {
      type: "object",
      additionalProperties: false,
      required: ["is_candidate", "hook_rank", "note"],
      properties: { is_candidate: { type: "boolean" }, hook_rank: { type: "integer" }, note: { type: "string" } },
    },
    subtitle_emphasis: { type: "array", items: { type: "string" } },
    bgm_mood: { type: "string" },
    checks: { type: "array", items: { type: "string" } },
  },
} as const;

const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["script", "critique", "title_candidates", "format", "target_minutes", "sources", "chapters", "shots"],
  properties: {
    script: { type: "string" },
    critique: { type: "array", items: { type: "string" } },
    title_candidates: { type: "array", items: { type: "string" } },
    format: { type: "string", enum: [...EPISODE_FORMATS] },
    target_minutes: { type: "number" },
    sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "url"], properties: { label: { type: "string" }, url: { type: "string" } } } },
    chapters: { type: "array", items: { type: "object", additionalProperties: false, required: ["chapter_id", "title"], properties: { chapter_id: { type: "string" }, title: { type: "string" } } } },
    shots: { type: "array", items: SHOT_SCHEMA },
  },
} as const;

interface ScriptOutput {
  script: string;
  critique: string[];
  title_candidates: string[];
  format: string;
  target_minutes: number;
  sources: { label: string; url: string }[];
  chapters: { chapter_id: string; title: string }[];
  shots: any[];
}

export const INSIGHT_MARKER = "[[考察：人間が追記]]";

function scriptRules(profile: VideoProfileId, minutes: number, maxI2v: number): string {
  const p = VIDEO_PROFILES[profile];
  const chars = Math.round(minutes * 300);
  return [
    "あなたは動画の構成作家です。台本と、同時にカット指示書（shots）を書きます。",
    profile === "ad"
      ? "構成: 冒頭 3 秒のフック → 課題 → 解決（商品・サービス） → 根拠 → 行動の呼びかけ。誇大表現・断定的な効果効能はしない。"
      : "構成: 冒頭 30 秒のフック → 本題 3〜5 トピック → 語り手の考察 → 締め（次回予告・体験談募集）。語り手は「調べた人が一人称で語る」スタイル。",
    `長さ: 約 ${minutes} 分（1 分あたり約 300 字、全体で約 ${chars} 字）。`,
    "事実と噂を分ける。事実には sources の出典を対応させ、出典のない話は「〜という説がある」「真偽不明」と書く。断定しすぎない。",
    "実在の事件・被害者を扱う場合は、被害者や遺族を傷つける表現をしない。実在の人物の写真・肖像を描くカットは作らない。",
    p.humanInsight ? `人間が追記する考察パートの位置に ${INSIGHT_MARKER} の目印を 1 か所だけ残す（台本本文の中に）。` : "",
    "カット指示書: 台本を 1 カット 3〜10 秒程度に区切り、各カットの narration には台本の該当部分をそのまま入れる（すべてのカットの narration をつなぐと台本の読み上げ部分になる）。",
    "visual.description は何を描くか（被写体・場所・時代・小物）、composition は構図（例: キャラ右寄り・バストアップ、左に資料）。キャラが出るカットは character: true と expression（通常/驚き/考え中/笑顔/怖がり/真剣）。",
    "style は通常 illustration。資料・図版は document。実写と見間違える絵（realistic: true）は原則作らない。画面内に文字を描かせない（文字はテロップで入れる）。",
    `motion_type: キャラの動きが必要なカットだけ i2v（全体で ${maxI2v} カットまで）、それ以外は pseudo（ズーム・パン）、読ませる資料は static。motion_note に動きを書く（カメラワークは控えめ）。`,
    p.shortCandidates ? `ショート候補（short_candidate.is_candidate: true）を ${p.shortCandidates.min}〜${p.shortCandidates.max} カット選び、hook_rank（1 が最優先）を付ける。候補でないカットは hook_rank: 0。` : "short_candidate.is_candidate はすべて false、hook_rank: 0。",
    "subtitle_emphasis は字幕で強調する語（そのカットの narration に含まれる語）。bgm_mood は 緊張/不穏/穏やか/明るい/悲しい など。checks は検品の観点（顔が設定書と一致・手指の破綻なし・画面内に文字なし・構図が指示どおり など）。",
    "chapters は章（chapter_id: ch01, ch02…）。shot_id は s001 から連番。title_candidates は 5 件（全角 30 字程度まで）。",
    "format は 深掘り回 / 体験談回 / ランキング回 / 前後編 から選ぶ。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function stepScript(ep: EpisodeRow, input: Record<string, unknown>) {
  const limits = await getVideoLimits();
  const profile = ep.profile as VideoProfileId;
  const sl0 = readShotlist(ep);
  const minutes = typeof input.targetMinutes === "number" ? input.targetMinutes : sl0.target_minutes || VIDEO_PROFILES[profile]?.minutes.default || 15;
  const topic = (ep.topics as unknown as TopicCandidate[])?.[typeof input.topicIndex === "number" ? input.topicIndex : -1];
  const recentFormats = (await prisma.videoEpisode.findMany({ where: { avatarId: ep.avatarId, id: { not: ep.id }, format: { not: null } }, orderBy: { createdAt: "desc" }, take: 3, select: { format: true } })).map((x) => x.format);
  const system = scriptRules(profile, minutes, limits.maxI2vShots);
  const brief = [
    await avatarBrief(ep.avatarId),
    `テーマ: ${ep.title || ep.theme || ""}`,
    topic ? `選ばれたネタ: ${topic.title}\n切り口: ${topic.angle}\n一次情報: ${topic.sources.map((s) => `${s.label} ${s.url}`).join(" / ")}` : "",
    ep.theme && profile === "ad" ? `依頼内容: ${ep.theme}` : "",
    recentFormats.length ? `直近の回の型（同じ型を 3 本連続させない）: ${recentFormats.join(" / ")}` : "",
    typeof input.feedback === "string" && input.feedback ? `修正の指示（必ず反映する）: ${input.feedback}` : "",
    typeof input.previousScript === "string" && input.previousScript ? `前回の台本（これを直す）:\n${input.previousScript.slice(0, 20000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // 章立て → 本文（1 回目）
  const draft = await completeJson<ScriptOutput>({ task: "video_script", system, user: `${brief}\n\n章立てを決めてから本文を書き、カット指示書を出力してください。critique は空配列でかまいません。`, json: { name: "script", schema: SCRIPT_SCHEMA } });
  // 自己批評 → 修正（2 回目）
  const revised = await completeJson<ScriptOutput>({
    task: "video_script",
    system,
    user: [
      brief,
      "次の台本とカット指示書を自己批評し、修正版を出力してください。",
      "批評の観点: 冒頭で続きが気になるか / 同じ言い回しの繰り返し / 断定しすぎ / 1 文が長すぎないか。critique に指摘を 3〜8 件書き、それを反映した修正版を script・shots に出力する。",
      JSON.stringify(draft.data).slice(0, 60000),
    ].join("\n\n"),
    json: { name: "script", schema: SCRIPT_SCHEMA },
  });
  const out = revised.data;
  for (const s of out.shots) if (s?.short_candidate && !s.short_candidate.is_candidate) s.short_candidate.hook_rank = null;
  const sl = normalizeShotlist({ ...out, target_minutes: minutes }, ep.episodeKey);
  await saveShotlist(ep.id, sl, "script", `台本を生成（${revised.model}）。自己批評: ${out.critique.slice(0, 8).join(" / ")}`.slice(0, 2000), "ai", { script: out.script, format: sl.format, title: ep.title || sl.title_candidates[0] || "" });
  await advanceStage(ep.id, "script", "approve_script");
  return { shots: sl.shots.length, critique: out.critique, model: revised.model };
}

// 5. ナレーション ---------------------------------------------------------------------------

export interface NarrationData {
  /** 文字数からの見積もり（音声未生成）なら true */
  estimated: boolean;
  chapters: { chapter_id: string; media: MediaRef | null; offset: number; duration: number; matchRate: number | null }[];
  timings: ShotTiming[];
  srt: string;
  /** 読み間違いの疑いがある章（台本との一致率が低い） */
  suspects: { chapter_id: string; matchRate: number }[];
}

/** 読み間違いの疑いとみなす一致率 */
const MATCH_THRESHOLD = 0.85;

async function stepNarration(ep: EpisodeRow, progress: Progress) {
  const sl = readShotlist(ep);
  const assets = await getVideoAssets(ep.avatarId);
  const fish = await fishConfig();
  const chapters: NarrationData["chapters"] = [];
  const timings: ShotTiming[] = [];
  const suspects: NarrationData["suspects"] = [];
  let offset = 0;
  for (const [i, ch] of sl.chapters.entries()) {
    const shots = sl.shots.filter((s) => s.chapter_id === ch.chapter_id);
    if (!shots.length) continue;
    const text = shots.map((s) => s.narration).join("\n");
    if (fish && assets.voiceId) {
      await progress(`章 ${i + 1} / ${sl.chapters.length} を音声にしています`);
      const spoken = applyReadingDict(text, assets.readingDict);
      const audio = await synthesize(fish, assets.voiceId, spoken);
      const media = await saveMedia(audio, `${ep.episodeKey}-${ch.chapter_id}.mp3`, "audio/mpeg");
      const tr = await transcribe(fish, audio);
      const matchRate = scriptMatchRate(spoken, tr.text);
      if (matchRate < MATCH_THRESHOLD) suspects.push({ chapter_id: ch.chapter_id, matchRate });
      const words = tr.segments.length ? tr.segments : [{ text, start: 0, end: tr.duration || estimateSeconds(text) }];
      timings.push(...alignShots(shots, words, offset));
      const duration = tr.duration || words[words.length - 1].end;
      chapters.push({ chapter_id: ch.chapter_id, media, offset, duration, matchRate });
      offset += duration + CHAPTER_GAP_SEC;
    } else {
      // 音声サービス未設定: 文字数から尺を見積もる（音声は後で作る / アップロードする）
      let at = offset;
      for (const s of shots) {
        const d = estimateSeconds(s.narration);
        timings.push({ shot_id: s.shot_id, start: at, end: at + d });
        at += d;
      }
      chapters.push({ chapter_id: ch.chapter_id, media: null, offset, duration: at - offset, matchRate: null });
      offset = at + CHAPTER_GAP_SEC;
    }
  }
  const estimated = !(fish && assets.voiceId);
  const srt = toSrt(buildCues(sl.shots, timings));
  const narration: NarrationData = { estimated, chapters, timings, srt, suspects };
  // カットの尺を確定（narration 工程の担当フィールドだけ。最新の指示書に当てる）
  await mutateShotlist(
    ep.id,
    (latest) => ({
      ...latest,
      shots: latest.shots.map((s) => {
        const t = timings.find((x) => x.shot_id === s.shot_id);
        return t ? patchShot(s, "narration", { duration_sec: Math.round((t.end - t.start) * 10) / 10, duration_fixed: !estimated }) : s;
      }),
    }),
    "narration",
    estimated ? "音声サービス未設定のため文字数から尺を見積もり" : "ナレーションのタイムスタンプで尺を確定",
    "system",
    { narration: narration as unknown as Prisma.InputJsonValue }
  );
  if (suspects.length) {
    await reportToHuman(ep, {
      what: `読み間違いの可能性がある章が ${suspects.length} 件あります`,
      where: `${ep.episodeKey}（${suspects.map((s) => `${s.chapter_id}: 一致率 ${Math.round(s.matchRate * 100)}%`).join(" / ")}）`,
      tried: "台本と文字起こしを照合しました",
      choices: ["読み辞書に追記してナレーションを作り直す", "このまま進める（絵コンテの生成は始まっています）"],
    });
  }
  // 絵コンテへ（全カットのジョブを依頼）
  if (await advanceStage(ep.id, "narration", "storyboard")) {
    for (const s of sl.shots) await enqueueVideoJob(ep.id, "storyboard", s.shot_id, { retries: 0 });
  }
  return { estimated, chapters: chapters.length, suspects: suspects.length };
}

// 6・8. 絵コンテ / 本番画像（生成 → 検品 → 作り直し） ---------------------------------------------

async function loadImages(names: string[], max: number): Promise<InputImage[]> {
  const out: InputImage[] = [];
  for (const n of names.slice(0, max)) {
    try {
      const b = await readMedia(n);
      out.push({ mimeType: n.endsWith(".png") ? "image/png" : n.endsWith(".webp") ? "image/webp" : "image/jpeg", data: b.toString("base64") });
    } catch {
      /* 消えた参照画像は飛ばす */
    }
  }
  return out;
}

function mediaUrl(appUrl: string, name: string) {
  return `${appUrl}/media/${name}`;
}

async function stepImage(step: "storyboard" | "final", ep: EpisodeRow, shotId: string, input: Record<string, unknown>) {
  const stageNow = step === "storyboard" ? "storyboard" : "final";
  const fresh = await prisma.videoEpisode.findUniqueOrThrow({ where: { id: ep.id } });
  // 絵コンテの差し戻し（承認 C 中）は approve_storyboard の工程でも作り直す
  const allowedStages = step === "storyboard" ? ["storyboard", "approve_storyboard"] : ["final"];
  if (!allowedStages.includes(fresh.stage)) return { skipped: `工程が ${fresh.stage} のため実行しませんでした` };
  const sl = readShotlist(fresh);
  const shot = sl.shots.find((s) => s.shot_id === shotId);
  if (!shot) throw new Error(`カット ${shotId} が見つかりません`);
  // 承認済みのカットは作り直さない（差し戻されたカットだけ）
  if (step === "storyboard" && shot.storyboard_review === "approved") return { skipped: "承認済みのカットのため作り直しません" };
  if (step === "final" && (shot.status !== "storyboard_ok" || shot.assets.final_image)) return { skipped: "絵コンテ未承認、または本番画像が作成済みです" };

  const [assets, imgCfg, limits, system] = await Promise.all([getVideoAssets(ep.avatarId), getVideoImageSettings(), getVideoLimits(), getSystemConfig()]);
  const retries = typeof input.retries === "number" ? input.retries : 0;
  const fix = typeof input.fix === "string" && input.fix ? `\n【前回の指摘（必ず直す）】${input.fix}` : "";
  const prompt = shotImagePrompt(shot, { style: assets.styleText, character: assets.characterText }) + fix;
  const refs = [
    ...(shot.visual.character ? await loadImages(assets.characterImages, 3) : []),
    ...(step === "final" && shot.assets.storyboard ? await loadImages([shot.assets.storyboard], 1) : []),
    ...(await loadImages(assets.styleImages, step === "final" ? 1 : 2)),
  ].slice(0, 4);
  const cfg = step === "storyboard" ? imgCfg.storyboard : imgCfg.final;
  const req: ImageRequest = {
    prompt,
    aspect: "1:1",
    references: refs,
    provider: cfg.provider ?? undefined,
    model: cfg.model || undefined,
    quality: cfg.quality,
    avatarId: ep.avatarId,
    purpose: `video_${step}`,
    format: "png",
  };
  let candidates: { ref: MediaRef; provider: string }[] = [];
  const providers = step === "final" && imgCfg.final.compare ? (["openai", "gemini"] as const) : [null];
  for (const p of providers) {
    const r = await generateImage(p ? { ...req, provider: p, model: undefined } : req);
    const square = step === "final" ? await toSquare(r.bytes, 2048) : r.bytes;
    candidates.push({ ref: await saveMedia(square, `${ep.episodeKey}-${shotId}-${step}.png`, "image/png"), provider: r.provider });
  }

  // 検品（候補が複数なら全部を検品してスコアの高い方）
  const reference = shot.visual.character && assets.characterImages[0] ? mediaUrl(system.appUrl, assets.characterImages[0]) : null;
  let best: { ref: MediaRef; qc: QcOutcome } | null = null;
  for (const c of candidates) {
    const qc = await inspectImage({ avatarId: ep.avatarId, subjectId: `${ep.id}:${shotId}:${step}`, phase: step, shot, retries, image: c.ref, imageUrl: mediaUrl(system.appUrl, c.ref.name), referenceUrl: reference, measure: await measureConfig(), limits });
    if (!best || rankQc(qc) > rankQc(best.qc)) best = { ref: c.ref, qc };
  }
  candidates = [];
  const { ref, qc } = best!;
  const qcPatch = { phase: step, result: qc.result, confidence: qc.confidence, engine: qc.engine, reason: qc.reason, note: qc.note, scores: qc.scores, retries };
  const assetKey = step === "storyboard" ? "storyboard" : "final_image";

  if (qc.action === "retry") {
    // 指摘を反映して作り直す（作り直しの回数を入力に入れるので別ジョブになる）
    await updateShot(ep.id, shotId, (s) => patchShot(s, step, { qc: { ...s.qc, ...qcPatch } }), step, `検品: 作り直し（${reasonLabel(qc.reason)}）`);
    await enqueueVideoJob(ep.id, step, shotId, { retries: retries + 1, fix: qc.note ?? reasonLabel(qc.reason) });
    return { action: "retry", reason: qc.reason };
  }
  if (qc.action === "stop") {
    await updateShot(
      ep.id,
      shotId,
      (s) => patchShot(s, step, { assets: { ...s.assets, [assetKey]: ref.name }, qc: { ...s.qc, ...qcPatch }, ...(step === "storyboard" ? { storyboard_review: "pending" as const } : {}) }),
      step,
      "作り直しの上限に達したため停止"
    );
    await reportToHuman(ep, {
      what: `作り直しが上限（${limits.maxRetries} 回）に達したためカットを止めました`,
      where: `${ep.episodeKey} / ${shotId}（${step === "storyboard" ? "絵コンテ" : "本番画像"}）`,
      tried: `${retries + 1} 回生成。最後の指摘: ${qc.note ?? reasonLabel(qc.reason)}`,
      choices: ["カットの描写・構図を書き直して作り直す", "このまま承認する（絵コンテ承認で判断）", "このカットを static（資料風）に変える"],
    });
  } else {
    // 合格、または人の判断待ち（保留）
    const passed = qc.action === "advance";
    await updateShot(
      ep.id,
      shotId,
      (s) =>
        patchShot(s, step, {
          assets: { ...s.assets, [assetKey]: ref.name },
          qc: { ...s.qc, ...qcPatch },
          ...(step === "final" && passed ? { status: "final_ok" as const } : {}),
          // 差し戻しで作り直した絵コンテは、もう一度承認 C を待つ
          ...(step === "storyboard" ? { storyboard_review: "pending" as const } : {}),
        }),
      step,
      passed ? "検品: 合格" : `検品: 保留（${qc.note ?? "人の確認が必要"}）`
    );
  }
  return { action: qc.action, engine: qc.engine, confidence: qc.confidence };
}

function rankQc(q: QcOutcome): number {
  const base = q.result === "pass" ? 2 : q.result === "hold" ? 1 : 0;
  return base + (q.confidence ?? 0);
}

async function toSquare(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  return new Uint8Array(await sharp(Buffer.from(bytes)).resize(size, size, { fit: "cover", position: "centre" }).png().toBuffer());
}

/** 工程の全カットが終わったら次の工程へ */
export async function maybeFinishImageStage(episodeId: string, step: "storyboard" | "final") {
  const pending = await prisma.videoJob.count({ where: { episodeId, step, status: { in: ["queued", "running"] } } });
  if (pending) return;
  const ep = await prisma.videoEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  const sl = readShotlist(ep);
  if (step === "storyboard") {
    if (sl.shots.every((s) => s.assets.storyboard)) await advanceStage(episodeId, "storyboard", "approve_storyboard");
    return;
  }
  if (!sl.shots.every((s) => s.status === "final_ok" || s.status === "video_ok" || s.status === "rendered")) return;
  await enterVideoStage(ep);
}

/** 本番画像がそろったら動画化へ。pseudo / static のカットは書き出し側で動かすので video_ok にする */
export async function enterVideoStage(ep: Pick<EpisodeRow, "id">) {
  let needsI2v = false;
  await mutateShotlist(
    ep.id,
    (sl, row) => {
      if (row.stage !== "final") return sl;
      sl.shots = assignPseudoMotions(sl.shots).map((s) => (s.motion_type !== "i2v" && s.status === "final_ok" ? patchShot(s, "video", { status: "video_ok" }) : s));
      needsI2v = sl.shots.some((s) => s.motion_type === "i2v" && s.status !== "video_ok");
      return sl;
    },
    "video",
    "本番画像がそろったため動画化へ"
  );
  if (!(await advanceStage(ep.id, "final", needsI2v ? "video" : "render"))) return;
  if (!needsI2v) await enqueueVideoJob(ep.id, "thumbnails", null, { round: 0 });
  // Kling の自動動画化がオンなら、i2v のカットを順に Kling へ（上限を超える分は人が pseudo に切り替えるか手で始める）
  else {
    const cfg = await klingConfig();
    if (cfg?.auto) await enqueueI2v(ep.id, null);
  }
}

// 9. 動画化（Kling i2v） ----------------------------------------------------------------

/** i2v のカット（まだ動画が無いもの）を Kling に回す。shotId を指定するとそのカットだけ。依頼した件数を返す */
export async function enqueueI2v(episodeId: string, shotId: string | null, feedback = ""): Promise<number> {
  const ep = await prisma.videoEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  if (ep.stage !== "video") throw new ConfigError("動画化（i2v）の工程ではありません");
  if (!(await klingConfig())) throw new ConfigError("Kling の Access Key / Secret Key が未設定です（設定 > 動画 > パイプライン設定）");
  const limits = await getVideoLimits();
  const sl = readShotlist(ep);
  const i2v = sl.shots.filter((s) => s.motion_type === "i2v");
  // 上限（1 本あたりの i2v カット数）を超える分は回さない
  const allowed = new Set(i2v.slice(0, limits.maxI2vShots).map((s) => s.shot_id));
  const targets = i2v.filter((s) => (shotId ? s.shot_id === shotId : s.status !== "video_ok") && s.assets.final_image);
  if (shotId && !targets.length) throw new ConfigError(`${shotId} は動画化できるカットではありません（i2v で本番画像があるカットだけ）`);
  if (shotId && !allowed.has(shotId)) throw new ConfigError(`動画化のカット数の上限（${limits.maxI2vShots}）を超えています。上限を上げるか、ほかのカットを pseudo に切り替えてください`);
  let n = 0;
  // 作り直しのたびに別のジョブにする（同じ入力のジョブは二重に走らせない仕組みのため、回数・指示を入力に入れる）
  const round = await prisma.videoJob.count({ where: { episodeId, step: "i2v" } });
  for (const s of targets) {
    if (!allowed.has(s.shot_id)) continue;
    const running = await prisma.videoJob.count({ where: { episodeId, step: "i2v", shotId: s.shot_id, status: { in: ["queued", "running"] } } });
    if (running) continue;
    await enqueueVideoJob(episodeId, "i2v", s.shot_id, { round, feedback });
    n++;
  }
  return n;
}

/** 1 カットを Kling で動画にして登録する */
async function stepI2v(ep: EpisodeRow, shotId: string, input: Record<string, unknown>, progress: Progress) {
  const cfg = await klingConfig();
  if (!cfg) throw new ConfigError("Kling の Access Key / Secret Key が未設定です（設定 > 動画 > パイプライン設定）");
  const fresh = await prisma.videoEpisode.findUniqueOrThrow({ where: { id: ep.id } });
  if (fresh.stage !== "video") return { skipped: "動画化の工程ではなくなりました" };
  const shot = readShotlist(fresh).shots.find((s) => s.shot_id === shotId);
  if (!shot || shot.motion_type !== "i2v") return { skipped: "i2v のカットではなくなりました" };
  if (!shot.assets.final_image) throw new ConfigError(`${shotId} の本番画像がありません`);
  const assets = await getVideoAssets(ep.avatarId);
  const prompt = [
    shot.motion_note && `動き: ${shot.motion_note}`,
    `場面: ${shot.visual.description}`,
    shot.visual.expression && `表情: ${shot.visual.expression}`,
    assets.characterText && "キャラクターの顔・髪型・服装は入力画像のまま保つ（別人にしない）。",
    "カメラワークは控えめ。画面に文字・字幕・ロゴを出さない。音声は不要。",
    typeof input.feedback === "string" && input.feedback ? `追加の指示: ${input.feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const image = new Uint8Array(await readMedia(shot.assets.final_image));
  await progress("Kling に依頼中");
  const r = await runI2v(cfg, { image, prompt }, { onTask: (id) => progress(`Kling タスク ${id}`), onProgress: progress });
  const ref = await saveMedia(r.bytes, `${ep.episodeKey}-${shotId}.mp4`, "video/mp4");
  await updateShot(
    ep.id,
    shotId,
    (s) => patchShot(s, "video", { assets: { ...s.assets, video: ref.name }, status: "video_ok", qc: { ...s.qc, phase: "video", engine: "kling", note: `Kling ${cfg.model}（${cfg.mode}・${r.duration ?? cfg.duration} 秒）で生成。人の確認待ち` } }),
    "video",
    `Kling で動画化（タスク ${r.taskId}）`
  );
  await maybeFinishVideoStage(ep.id);
  return { taskId: r.taskId, media: ref.name, duration: r.duration };
}

/** i2v のカットがすべて動画になったら書き出しへ */
export async function maybeFinishVideoStage(episodeId: string) {
  const ep = await prisma.videoEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  const sl = readShotlist(ep);
  if (!sl.shots.every((s) => s.status === "video_ok" || s.status === "rendered")) return;
  await mutateShotlist(episodeId, (latest) => ({ ...latest, shots: assignPseudoMotions(latest.shots) }), "video", "擬似アニメの動きを割り当て");
  const moved = await prisma.videoEpisode.updateMany({ where: { id: episodeId, stage: "video" }, data: { stage: "render" } });
  if (moved.count) await enqueueVideoJob(episodeId, "thumbnails", null, { round: 0 });
}

// 10. サムネイル（3 案） ------------------------------------------------------------------

async function stepThumbnails(ep: EpisodeRow, input: Record<string, unknown>) {
  const [assets, imgCfg] = await Promise.all([getVideoAssets(ep.avatarId), getVideoImageSettings()]);
  const sl = readShotlist(ep);
  const refs = await loadImages(assets.characterImages, 3);
  const title = ep.title || sl.title_candidates[0] || "";
  const variants = ["キャラの驚いた表情のアップ＋題材の象徴物（右側）", "キャラの真剣な表情のアップ＋題材の象徴物（左側）、背景は暗め", "キャラの怖がる表情＋題材の象徴物を大きく、強いコントラスト"];
  const out: MediaRef[] = [];
  for (const v of variants) {
    const r = await generateImage({
      prompt: [
        assets.styleText && `【画風】${assets.styleText}`,
        assets.characterText && `【キャラクター設定（必ず守る）】${assets.characterText}`,
        `【動画】${title}`,
        `【構図】${v}`,
        "YouTube のサムネイル。文字は入れない（タイトル文字は後で合成する）。左上・右下に文字を置く余白を残す。実在の人物・既存キャラクターに似せない。",
        typeof input.feedback === "string" && input.feedback ? `【追加の指示】${input.feedback}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      aspect: "16:9",
      references: refs,
      provider: imgCfg.thumbnail.provider ?? undefined,
      model: imgCfg.thumbnail.model || undefined,
      avatarId: ep.avatarId,
      purpose: "video_thumbnail",
      format: "png",
    });
    const sharp = (await import("sharp")).default;
    const fitted = new Uint8Array(await sharp(Buffer.from(r.bytes)).resize(1280, 720, { fit: "cover", position: "attention" }).png().toBuffer());
    out.push(await saveMedia(fitted, `${ep.episodeKey}-thumb.png`, "image/png"));
  }
  await prisma.videoEpisode.update({ where: { id: ep.id }, data: { thumbnails: out as unknown as Prisma.InputJsonValue } });
  return { count: out.length };
}

