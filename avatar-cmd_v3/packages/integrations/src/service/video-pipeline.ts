// ================================================
// 動画パイプライン — エピソードの作成・人の承認（A〜D）・アップロード・投稿
// ================================================
// 指示書: docs/VIDEO_PIPELINE.md
// ・承認 A（ネタ）・B（台本）・C（絵コンテ）・D（公開前）は人が行う。ここにある関数だけが承認を記録し、工程を進める。
// ・差し戻しは該当カットだけを該当工程からやり直す。承認済みのカットは作り直さない。
// ・公開は承認 D の後だけ。YouTube は非公開でアップロードして予約公開、TikTok / Instagram は指定日時に予約投稿する。
// ・動画化（Kling）と書き出し（Remotion + FFmpeg）は外部で行い、できたファイルをアップロードする（書き出しに必要な情報は manifest で渡す）。

import { prisma, Prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { createPosts } from "./publish";
import { recordHumanAction } from "./decision";
import { mediaExists, type MediaRef } from "./media";
import { getSystemConfig } from "./store";
import { getVideoAssets, getVideoLimits } from "./video-config";
import {
  episodeCost,
  monthlyVideoCost,
  mutateShotlist,
  overBudget,
  readShotlist,
  saveShotlist,
  STAGES,
  stageLabel,
  textSimilarity,
  updateShot,
  type EpisodeReport,
  type EpisodeRow,
} from "./video-episode";
import { enqueueVideoJob, enterVideoStage, INSIGHT_MARKER, maybeFinishImageStage, type NarrationData, type TopicCandidate } from "./video-jobs";
import { isVideoProfile, normalizeTargets, VIDEO_PROFILES, VIDEO_TARGETS, type VideoProfileId, type VideoTargetId } from "./video-profiles";
import { assignPseudoMotions, buildCues, chapterTimestamps, formatRotationIssue, needsDisclosure, normalizeShotlist, patchShot, proposePseudoFallback, validateShotlist, type Shot, type Shotlist } from "./video-shotlist";

// --- 作成 ---------------------------------------------------------------------------

function slug(s: string): string {
  const ascii = s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return ascii || Math.random().toString(36).slice(2, 8);
}

function jstDate(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export interface CreateEpisodeInput {
  avatarId: string;
  profile?: string;
  targets?: string[];
  /** ジャンル・テーマ（広告は依頼内容） */
  theme?: string;
  /** 英数字の短い名前（episode_id の後半）。省略時は自動 */
  key?: string;
  targetMinutes?: number;
}

export async function createEpisode(input: CreateEpisodeInput) {
  const avatar = await prisma.avatar.findUnique({ where: { id: input.avatarId } });
  if (!avatar) throw new ConfigError("アバターを選択してください");
  const profile: VideoProfileId = isVideoProfile(input.profile) ? input.profile : "long_with_clips";
  const p = VIDEO_PROFILES[profile];
  const theme = input.theme?.trim().slice(0, 4000) ?? "";
  if (!p.topics && !theme) throw new ConfigError("広告・PR は依頼内容（商品・訴求・ターゲット）を入力してください");
  // 1 か月の費用上限を超えていれば新しいエピソードを始めない
  const limits = await getVideoLimits();
  const month = await monthlyVideoCost();
  if (overBudget(month.amounts, limits.monthlyBudget, limits.currency)) {
    throw new ConfigError(`今月の動画の費用が上限（${limits.monthlyBudget} ${limits.currency}）に達しているため、新しいエピソードは始められません（設定 > 動画 で上限を確認）`);
  }
  const minutes = Math.min(p.minutes.max, Math.max(p.minutes.min, Number(input.targetMinutes) || p.minutes.default));
  let episodeKey = `${jstDate()}_${slug(input.key || theme)}`;
  if (await prisma.videoEpisode.findUnique({ where: { episodeKey } })) episodeKey += `-${Math.random().toString(36).slice(2, 6)}`;
  const shotlist = normalizeShotlist({ target_minutes: minutes }, episodeKey);
  const ep = await prisma.videoEpisode.create({
    data: {
      avatarId: avatar.id,
      episodeKey,
      profile,
      targets: normalizeTargets(profile, input.targets),
      theme,
      stage: p.topics ? "topics" : "script",
      shotlist: shotlist as unknown as Prisma.InputJsonValue,
    },
  });
  await enqueueVideoJob(ep.id, p.topics ? "topics" : "script", null, p.topics ? {} : { targetMinutes: minutes });
  return getEpisodeView(ep.id);
}

// --- 表示 ---------------------------------------------------------------------------

/** 人の承認を待つ工程なら承認の記号（A〜D） */
export function stageGate(stage: string): string | null {
  const s = STAGES.find((x) => x.id === stage);
  return s && "gate" in s ? s.gate : null;
}

export async function listEpisodes(opts: { avatarId?: string; limit?: number } = {}) {
  const rows = await prisma.videoEpisode.findMany({
    where: opts.avatarId ? { avatarId: opts.avatarId } : {},
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    include: { avatar: { select: { name: true } } },
  });
  return rows.map((e) => {
    const sl = readShotlist(e);
    return {
      id: e.id,
      episodeKey: e.episodeKey,
      title: e.title,
      avatarId: e.avatarId,
      avatarName: e.avatar.name,
      profile: e.profile,
      format: e.format,
      targets: e.targets,
      stage: e.stage,
      stageLabel: stageLabel(e.stage),
      gate: stageGate(e.stage),
      status: e.status,
      shots: sl.shots.length,
      report: e.report as EpisodeReport | null,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  });
}

export async function getEpisodeView(id: string) {
  const ep = await prisma.videoEpisode.findUnique({ where: { id }, include: { avatar: { select: { name: true } } } });
  if (!ep) throw new ConfigError("エピソードが見つかりません");
  const sl = readShotlist(ep);
  const limits = await getVideoLimits();
  const profile = VIDEO_PROFILES[ep.profile as VideoProfileId] ?? VIDEO_PROFILES.long_with_clips;
  const [jobs, cost, revisions, assets] = await Promise.all([
    prisma.videoJob.findMany({ where: { episodeId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    episodeCost(id),
    prisma.videoShotlistRevision.findMany({ where: { episodeId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, step: true, reason: true, by: true, createdAt: true } }),
    getVideoAssets(ep.avatarId),
  ]);
  return {
    id: ep.id,
    episodeKey: ep.episodeKey,
    title: ep.title,
    avatarId: ep.avatarId,
    avatarName: ep.avatar.name,
    profile: ep.profile,
    profileLabel: profile.label,
    format: ep.format,
    targets: ep.targets,
    stage: ep.stage,
    stageLabel: stageLabel(ep.stage),
    stages: STAGES,
    status: ep.status,
    theme: ep.theme,
    topics: ep.topics as unknown as TopicCandidate[],
    script: ep.script,
    shotlist: sl,
    issues: validateShotlist(sl, { maxI2vShots: limits.maxI2vShots, shortCandidates: profile.shortCandidates }),
    pseudoFallback: proposePseudoFallback(sl, limits.maxI2vShots),
    disclosure: needsDisclosure(sl),
    insightMarker: profile.humanInsight ? INSIGHT_MARKER : null,
    narration: ep.narration as unknown as Partial<NarrationData>,
    renders: ep.renders as unknown as Record<string, MediaRef>,
    thumbnails: ep.thumbnails as unknown as MediaRef[],
    publishPlan: ep.publishPlan,
    approvals: ep.approvals,
    report: ep.report as EpisodeReport | null,
    cost: { ...cost, limit: limits.episodeBudget, currency: limits.currency },
    assetsApproved: !!assets.approvedAt,
    jobs: jobs.map((j) => ({ id: j.id, step: j.step, shotId: j.shotId, status: j.status, attempts: j.attempts, progress: j.progress, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt })),
    revisions,
    createdAt: ep.createdAt,
  };
}

// --- 共通 ---------------------------------------------------------------------------

async function loadEpisode(id: string): Promise<EpisodeRow> {
  const ep = await prisma.videoEpisode.findUnique({ where: { id } });
  if (!ep) throw new ConfigError("エピソードが見つかりません");
  return ep;
}

function assertStage(ep: EpisodeRow, ...stages: string[]) {
  if (ep.status === "cancelled" || ep.status === "done") throw new ConfigError("このエピソードは終了しています");
  if (!stages.includes(ep.stage)) throw new ConfigError(`今の工程（${stageLabel(ep.stage)}）ではこの操作はできません`);
}

async function recordApproval(ep: EpisodeRow, gate: "A" | "B" | "C" | "D", note: string | null, by: string, extra: Prisma.VideoEpisodeUpdateInput = {}, nextStage?: string) {
  const approvals = { ...((ep.approvals ?? {}) as Record<string, unknown>), [gate]: { at: new Date().toISOString(), by, note } };
  await prisma.videoEpisode.update({ where: { id: ep.id }, data: { ...extra, approvals: approvals as Prisma.InputJsonValue, report: Prisma.JsonNull, ...(nextStage ? { stage: nextStage } : {}) } });
}

// --- 承認 A: ネタ選定 -------------------------------------------------------------------

export async function approveTopic(id: string, input: { index: number; title?: string; note?: string; targetMinutes?: number }, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_topic");
  const topics = ep.topics as unknown as TopicCandidate[];
  const t = topics[input.index];
  if (!t) throw new ConfigError("ネタを選んでください");
  const title = input.title?.trim().slice(0, 200) || t.title;
  await recordApproval(ep, "A", input.note?.trim() || null, by, { title }, "script");
  await enqueueVideoJob(ep.id, "script", null, { topicIndex: input.index, ...(input.targetMinutes ? { targetMinutes: Number(input.targetMinutes) } : {}) });
  return getEpisodeView(id);
}

/** ネタ候補を作り直す（指示を添えて） */
export async function regenerateTopics(id: string, feedback: string) {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_topic", "topics");
  await prisma.videoEpisode.update({ where: { id }, data: { stage: "topics" } });
  await enqueueVideoJob(id, "topics", null, { feedback: feedback.trim().slice(0, 2000), at: Date.now() });
  return getEpisodeView(id);
}

// --- 承認 B: 台本確認 -------------------------------------------------------------------

/** 人が台本・カット指示書を直す（考察の追記など）。カット指示書を出し直す場合は丸ごと渡す */
export async function updateScript(id: string, input: { script?: string; shotlist?: unknown; title?: string }, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_script");
  const data: Prisma.VideoEpisodeUpdateInput = {};
  if (typeof input.script === "string") data.script = input.script.slice(0, 200_000);
  if (typeof input.title === "string") data.title = input.title.trim().slice(0, 200);
  if (input.shotlist !== undefined) {
    const sl = normalizeShotlist(input.shotlist, ep.episodeKey);
    // 人の修正でも、各カットの工程の状態（画像・検品）は台本段階では持たない
    await saveShotlist(ep.id, sl, "human", "人が台本・カット指示書を修正", by, { ...data, format: sl.format });
  } else if (Object.keys(data).length) {
    await prisma.videoEpisode.update({ where: { id }, data });
  }
  return getEpisodeView(id);
}

/** 1 カットの台本部分を人が直す */
export async function updateShotByHuman(id: string, shotId: string, patch: Partial<Shot>, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_script", "approve_storyboard", "final", "video");
  const allowed: (keyof Shot)[] = ["narration", "visual", "motion_type", "motion_note", "short_candidate", "subtitle_emphasis", "bgm_mood", "checks", "review_note"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof Shot))) as Partial<Shot>;
  if (ep.stage !== "approve_script" && (clean.narration !== undefined || clean.visual !== undefined)) {
    if (ep.stage !== "approve_storyboard") throw new ConfigError("セリフ・描写は台本確認か絵コンテ承認のときだけ直せます");
  }
  await updateShot(ep.id, shotId, (s) => patchShot(s, "human", clean), "human", "人がカットを修正", by);
  return getEpisodeView(id);
}

export async function requestScriptRevision(id: string, feedback: string) {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_script");
  if (!feedback.trim()) throw new ConfigError("修正の指示を入力してください");
  await prisma.videoEpisode.update({ where: { id }, data: { stage: "script" } });
  await enqueueVideoJob(id, "script", null, { feedback: feedback.trim().slice(0, 4000), previousScript: ep.script ?? "", at: Date.now() });
  return getEpisodeView(id);
}

/** 承認 B で確かめること（エラーがあれば承認できない） */
export async function scriptChecks(ep: EpisodeRow): Promise<{ errors: string[]; warnings: string[] }> {
  const sl = readShotlist(ep);
  const limits = await getVideoLimits();
  const profile = VIDEO_PROFILES[ep.profile as VideoProfileId] ?? VIDEO_PROFILES.long_with_clips;
  const { errors, warnings } = validateShotlist(sl, { maxI2vShots: limits.maxI2vShots, shortCandidates: profile.shortCandidates });
  if (!ep.script?.trim()) errors.push("台本が空です");
  if (profile.humanInsight && ep.script?.includes(INSIGHT_MARKER)) errors.push(`考察パートが未記入です（台本の ${INSIGHT_MARKER} を人が書いた考察 2〜3 行に置き換えてください）`);
  const recent = await prisma.videoEpisode.findMany({ where: { avatarId: ep.avatarId, id: { not: ep.id }, stage: { notIn: ["topics", "approve_topic", "script", "approve_script"] } }, orderBy: { createdAt: "desc" }, take: 5, select: { format: true, title: true } });
  const rot = formatRotationIssue(sl.format, recent.map((r) => r.format));
  if (rot) (rot.level === "error" ? errors : warnings).push(rot.message);
  for (const r of recent) if (ep.title && r.title && textSimilarity(ep.title, r.title) >= 0.6) warnings.push(`タイトルが最近の回「${r.title}」と似ています`);
  const assets = await getVideoAssets(ep.avatarId);
  if (!assets.approvedAt) errors.push("固定アセット（キャラ設定書・画風ガイド・声）が未確定です（設定 > 動画 > 固定アセット で確定してください）");
  return { errors, warnings };
}

export async function approveScript(id: string, input: { note?: string } = {}, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_script");
  const { errors } = await scriptChecks(ep);
  if (errors.length) throw new ConfigError(`承認できません:\n・${errors.join("\n・")}`);
  await recordApproval(ep, "B", input.note?.trim() || null, by, {}, "narration");
  await enqueueVideoJob(ep.id, "narration", null, { script: ep.script?.length ?? 0, at: Date.now() });
  return getEpisodeView(id);
}

/** 読み辞書を直したあとにナレーションを作り直す（絵コンテ・承認済みカットはそのまま） */
export async function regenerateNarration(id: string) {
  const ep = await loadEpisode(id);
  assertStage(ep, "storyboard", "approve_storyboard", "final", "video", "render");
  // narration 工程は stage=narration のときだけ次へ進めるため、ここでは音声と尺・字幕の作り直しだけが行われる
  await enqueueVideoJob(ep.id, "narration", null, { redo: Date.now() });
  return getEpisodeView(id);
}

// --- 承認 C: 絵コンテ ---------------------------------------------------------------------

export interface StoryboardDecision {
  shotId: string;
  approve: boolean;
  note?: string;
}

export async function reviewStoryboard(id: string, decisions: StoryboardDecision[], by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_storyboard");
  for (const d of decisions) {
    const note = d.note?.trim().slice(0, 1000) || null;
    if (!d.approve && !note) throw new ConfigError(`${d.shotId}: 差し戻しの理由を入力してください`);
    await updateShot(
      ep.id,
      d.shotId,
      (s) => {
        if (!s.assets.storyboard) throw new ConfigError(`${s.shot_id}: 絵コンテがまだありません`);
        return d.approve
          ? patchShot(s, "storyboard_review", { storyboard_review: "approved", status: "storyboard_ok", review_note: note ?? s.review_note })
          : patchShot(s, "storyboard_review", { storyboard_review: "rejected", review_note: note });
      },
      "storyboard_review",
      d.approve ? "承認C: 承認" : `承認C: 差し戻し（${note}）`,
      by
    );
    await recordHumanAction(`${ep.id}:${d.shotId}:storyboard`, d.approve ? "approved" : "rejected");
    // 差し戻しはそのカットだけ作り直す（理由をプロンプトに入れる）
    if (!d.approve) await enqueueVideoJob(ep.id, "storyboard", d.shotId, { retries: 0, fix: note, rejectedAt: Date.now() });
  }
  const sl = readShotlist(await loadEpisode(id));
  if (sl.shots.length && sl.shots.every((s) => s.storyboard_review === "approved")) {
    const fresh = await loadEpisode(id);
    await recordApproval(fresh, "C", null, by, {}, "final");
    for (const s of sl.shots) await enqueueVideoJob(ep.id, "final", s.shot_id, { retries: 0 });
  }
  return getEpisodeView(id);
}

/**
 * 自動の作り直しが止まった・検品が保留のカットを人が判断する。
 * accept: 今の画像で合格にする / regenerate: 指示を添えて作り直す（作り直しの回数は 0 から）
 */
export async function resolveShot(id: string, shotId: string, input: { action: "accept" | "regenerate"; note?: string }, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "storyboard", "approve_storyboard", "final");
  const phase = ep.stage === "final" ? "final" : "storyboard";
  const note = input.note?.trim().slice(0, 1000) || null;
  if (input.action === "regenerate") {
    await enqueueVideoJob(ep.id, phase, shotId, { retries: 0, fix: note, manual: Date.now() });
  } else {
    await updateShot(
      ep.id,
      shotId,
      (s) => {
        const asset = phase === "final" ? s.assets.final_image : s.assets.storyboard;
        if (!asset) throw new ConfigError(`${s.shot_id}: 画像がまだありません`);
        return patchShot(s, phase, { qc: { ...s.qc, result: "pass", engine: "human", note }, ...(phase === "final" ? { status: "final_ok" as const } : {}) });
      },
      phase,
      `人が合格にした（${note ?? "メモなし"}）`,
      by
    );
    await recordHumanAction(`${ep.id}:${shotId}:${phase}`, "approved");
    await maybeFinishImageStage(ep.id, phase);
  }
  return getEpisodeView(id);
}

// --- 9. 動画化（i2v） -------------------------------------------------------------------

/** 動画化したカット（Kling などで作った動画）をアップロードする。i2v のカットを pseudo に切り替えることもできる */
export async function setShotVideo(id: string, shotId: string, input: { media?: MediaRef; switchToPseudo?: boolean }, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "video");
  if (input.media && !input.media.mimeType.startsWith("video/")) throw new ConfigError("動画ファイルを選んでください");
  if (input.media && !(await mediaExists(input.media.name))) throw new ConfigError("アップロードしたファイルが見つかりません");
  const sl = await updateShot(
    ep.id,
    shotId,
    (s) => {
      if (s.motion_type !== "i2v") throw new ConfigError(`${s.shot_id} は動画化（i2v）のカットではありません`);
      if (input.switchToPseudo) return patchShot(s, "video", { motion_type: "pseudo", status: "video_ok" });
      if (!input.media) throw new ConfigError("動画を選ぶか、pseudo への切り替えを選んでください");
      return patchShot(s, "video", { assets: { ...s.assets, video: input.media.name }, status: "video_ok" });
    },
    "video",
    input.switchToPseudo ? "人が pseudo に切り替え" : "動画化したカットを登録",
    by
  );
  if (sl.shots.every((s) => s.status === "video_ok" || s.status === "rendered")) {
    await mutateShotlist(id, (latest) => ({ ...latest, shots: assignPseudoMotions(latest.shots) }), "video", "擬似アニメの動きを割り当て");
    const moved = await prisma.videoEpisode.updateMany({ where: { id, stage: "video" }, data: { stage: "render" } });
    if (moved.count) await enqueueVideoJob(id, "thumbnails", null, { round: 0 });
  }
  return getEpisodeView(id);
}

// --- 10. 書き出し ---------------------------------------------------------------------

/** 書き出し（Remotion + FFmpeg）に必要な情報。外部の書き出しサーバーはこれを読んで動画を作る */
export async function renderManifest(id: string) {
  const ep = await loadEpisode(id);
  const sl = readShotlist(ep);
  const system = await getSystemConfig();
  const assets = await getVideoAssets(ep.avatarId);
  const narration = (ep.narration ?? {}) as Partial<NarrationData>;
  const timings = narration.timings ?? [];
  const url = (name: string | null | undefined) => (name ? `${system.appUrl}/media/${name}` : null);
  const shots = sl.shots.map((s) => {
    const t = timings.find((x) => x.shot_id === s.shot_id);
    return {
      shot_id: s.shot_id,
      chapter_id: s.chapter_id,
      start: t?.start ?? null,
      end: t?.end ?? null,
      image: url(s.assets.final_image),
      video: url(s.assets.video),
      motion_type: s.motion_type,
      pseudo_motion: s.pseudo_motion ?? null,
      expression: s.visual.expression,
      subtitle_emphasis: s.subtitle_emphasis,
      bgm_mood: s.bgm_mood,
      short_candidate: s.short_candidate,
    };
  });
  return {
    episode_id: ep.episodeKey,
    title: ep.title,
    targets: ep.targets.map((t) => ({ ...VIDEO_TARGETS[t as VideoTargetId] })),
    narration: (narration.chapters ?? []).map((c) => ({ chapter_id: c.chapter_id, audio: url(c.media?.name), offset: c.offset, duration: c.duration })),
    chapters: sl.chapters,
    shots,
    subtitles: {
      cues: buildCues(sl.shots, timings),
      srt: narration.srt ?? "",
      per_line: 16,
      lines: 2,
    },
    brand: assets.brand,
    rules: {
      long: { width: 1920, height: 1080, end_screen_sec: 20, chapter_titles: true, source_display: true },
      bgm_ducking_db: -18,
      pseudo: { zoom: [1.0, 1.08], blink_interval_sec: [3, 5] },
      disclosure_required: needsDisclosure(sl),
    },
    sources: sl.sources,
  };
}

/** 書き出した動画（出力先ごと）を登録する */
export async function setRender(id: string, target: string, media: MediaRef | null, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "render", "approve_publish");
  if (!ep.targets.includes(target)) throw new ConfigError(`このエピソードの出力先ではありません: ${target}`);
  if (media && !media.mimeType.startsWith("video/")) throw new ConfigError("動画ファイルを選んでください");
  if (media && !(await mediaExists(media.name))) throw new ConfigError("アップロードしたファイルが見つかりません");
  const renders = { ...((ep.renders ?? {}) as unknown as Record<string, MediaRef>) };
  if (media) renders[target] = media;
  else delete renders[target];
  await prisma.videoEpisode.update({ where: { id }, data: { renders: renders as unknown as Prisma.InputJsonValue } });
  await maybeReadyForApproval(id, by);
  return getEpisodeView(id);
}

/** サムネイル候補を追加・差し替え（背景とキャラだけ生成して、文字は後から合成したものをアップロードする場合など） */
export async function setThumbnails(id: string, input: { add?: MediaRef; remove?: string; regenerate?: string }) {
  const ep = await loadEpisode(id);
  assertStage(ep, "render", "approve_publish");
  if (input.regenerate !== undefined) {
    await enqueueVideoJob(id, "thumbnails", null, { feedback: input.regenerate.slice(0, 1000), at: Date.now() });
    return getEpisodeView(id);
  }
  let thumbs = (ep.thumbnails ?? []) as unknown as MediaRef[];
  if (input.add) {
    if (!input.add.mimeType.startsWith("image/")) throw new ConfigError("画像ファイルを選んでください");
    thumbs = [...thumbs, input.add].slice(-6);
  }
  if (input.remove) thumbs = thumbs.filter((t) => t.name !== input.remove);
  await prisma.videoEpisode.update({ where: { id }, data: { thumbnails: thumbs as unknown as Prisma.InputJsonValue } });
  await maybeReadyForApproval(id, "human");
  return getEpisodeView(id);
}

/** すべての出力先の動画とサムネイルがそろったら承認 D へ */
async function maybeReadyForApproval(id: string, by: string) {
  const ep = await loadEpisode(id);
  const renders = (ep.renders ?? {}) as unknown as Record<string, MediaRef>;
  const thumbs = (ep.thumbnails ?? []) as unknown as MediaRef[];
  const ready = ep.targets.every((t) => renders[t]) && thumbs.length > 0;
  if (ep.stage === "render" && ready) {
    await mutateShotlist(id, (sl) => ({ ...sl, shots: sl.shots.map((s) => (s.status === "video_ok" ? patchShot(s, "render", { status: "rendered" }) : s)) }), "render", "書き出し完了", by, { stage: "approve_publish" });
  }
}

// --- 承認 D: 公開前の最終確認 → 投稿 -------------------------------------------------------

/** 概要欄の下書き（導入文・チャプター・出典・BGM の帰属表記・ハッシュタグ 3 つまで） */
export function buildDescription(ep: Pick<EpisodeRow, "title" | "script">, sl: Shotlist, narration: Partial<NarrationData>, input: { intro?: string; credits?: string; hashtags?: string[] } = {}): string {
  const intro = input.intro?.trim() || (ep.script ?? "").replace(/\s+/g, " ").slice(0, 120);
  const chapters = chapterTimestamps(sl, narration.timings ?? []);
  const tags = (input.hashtags ?? []).map((t) => t.trim().replace(/^#?/, "#")).filter((t) => t.length > 1).slice(0, 3);
  return [
    intro,
    chapters.length >= 3 ? `\n■ チャプター\n${chapters.join("\n")}` : "",
    sl.sources.length ? `\n■ 出典\n${sl.sources.map((s) => `${s.label} ${s.url}`).join("\n")}` : "",
    input.credits?.trim() ? `\n■ BGM\n${input.credits.trim()}` : "",
    tags.length ? `\n${tags.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
}

export async function descriptionDraft(id: string) {
  const ep = await loadEpisode(id);
  return buildDescription(ep, readShotlist(ep), (ep.narration ?? {}) as Partial<NarrationData>);
}

export interface PublishTargetPlan {
  accountId: string;
  /** 公開日時（ISO 8601）。YouTube は予約公開、TikTok / Instagram はこの日時に投稿する */
  publishAt: string;
  /** 本文（TikTok / Instagram のキャプション。YouTube は概要欄） */
  text?: string;
  /** TikTok: 投稿者に示して同意を得た投稿設定（ガイドラインの必須要件） */
  tiktok?: { privacyLevel: string; disableComment: boolean; disableDuet: boolean; disableStitch: boolean; consent: boolean };
  /** Instagram: リールをフィードにも表示するか */
  shareToFeed?: boolean;
}

export interface PublishPlanInput {
  title: string;
  description: string;
  thumbnail: string;
  tags?: string[];
  targets: Partial<Record<VideoTargetId, PublishTargetPlan>>;
  /** 改変・合成コンテンツの開示を人が Studio で設定する、と確認した（realistic なカットがあるとき必須） */
  disclosureConfirmed?: boolean;
  /** 子ども向けではないことの確認（毎回明示） */
  madeForKids: boolean;
  note?: string;
}

export async function approvePublish(id: string, plan: PublishPlanInput, by = "human") {
  const ep = await loadEpisode(id);
  assertStage(ep, "approve_publish");
  const sl = readShotlist(ep);
  const renders = (ep.renders ?? {}) as unknown as Record<string, MediaRef>;
  const thumbs = (ep.thumbnails ?? []) as unknown as MediaRef[];
  const thumb = thumbs.find((t) => t.name === plan.thumbnail);
  if (!thumb) throw new ConfigError("サムネイルを選んでください");
  if (!plan.title?.trim()) throw new ConfigError("タイトルを入力してください");
  if (typeof plan.madeForKids !== "boolean") throw new ConfigError("子ども向けかどうかを選んでください");
  if (needsDisclosure(sl) && !plan.disclosureConfirmed) throw new ConfigError("実写と見間違えるカットがあります。YouTube Studio で「改変されたコンテンツ」を「はい」にすることを確認してください");
  const now = Date.now();
  const narration = (ep.narration ?? {}) as Partial<NarrationData>;
  const created: { target: string; contentId: string; accountId: string; publishAt: string }[] = [];
  // 先にすべて検証してから投稿を作る（途中で失敗して一部だけ予約される状態を避ける）
  const prepared: { target: VideoTargetId; plan: PublishTargetPlan; at: Date; platform: string }[] = [];
  for (const t of ep.targets as VideoTargetId[]) {
    const p = plan.targets[t];
    if (!p) throw new ConfigError(`${VIDEO_TARGETS[t].label}: 投稿先アカウントと公開日時を指定してください`);
    if (!renders[t]) throw new ConfigError(`${VIDEO_TARGETS[t].label}: 書き出した動画がありません`);
    const at = new Date(p.publishAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= now + 5 * 60_000) throw new ConfigError(`${VIDEO_TARGETS[t].label}: 公開日時は 5 分以上先にしてください`);
    const acc = await prisma.snsAccount.findUnique({ where: { id: p.accountId } });
    if (!acc || !acc.isActive) throw new ConfigError(`${VIDEO_TARGETS[t].label}: 投稿先アカウントが見つかりません`);
    if (acc.platform !== VIDEO_TARGETS[t].platform) throw new ConfigError(`${VIDEO_TARGETS[t].label}: ${VIDEO_TARGETS[t].platform} のアカウントを選んでください`);
    if (acc.avatarId !== ep.avatarId) throw new ConfigError(`${VIDEO_TARGETS[t].label}: このエピソードのアバターのアカウントを選んでください`);
    if (t === "tiktok") {
      const s = (acc.settings ?? {}) as Record<string, string>;
      if (s.postMode !== "draft") {
        if (!p.tiktok?.consent) throw new ConfigError("TikTok: 公開範囲・コメント/デュエット/リミックスの設定を確認し、同意してください");
        if (!["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"].includes(p.tiktok.privacyLevel)) throw new ConfigError("TikTok: 公開範囲を選んでください");
      }
    }
    prepared.push({ target: t, plan: p, at, platform: acc.platform });
  }
  for (const { target, plan: p, at } of prepared) {
    const long = target === "youtube_long";
    const youtube = target === "youtube_long" || target === "youtube_shorts";
    const media = [renders[target], ...(long ? [thumb] : [])];
    const options: Record<string, string> = youtube
      ? {
          title: plan.title.slice(0, 100),
          publishAt: at.toISOString(),
          madeForKids: String(plan.madeForKids),
          ...(long && narration.srt ? { captionsSrt: narration.srt } : {}),
        }
      : target === "tiktok"
        ? {
            aiGenerated: "true",
            ...(p.tiktok
              ? { privacyLevel: p.tiktok.privacyLevel, disableComment: String(p.tiktok.disableComment), disableDuet: String(p.tiktok.disableDuet), disableStitch: String(p.tiktok.disableStitch) }
              : {}),
          }
        : { shareToFeed: String(p.shareToFeed !== false) };
    const text = youtube ? (long ? plan.description : `${plan.title}\n${(plan.tags ?? []).slice(0, 3).map((x) => `#${x.replace(/^#/, "")}`).join(" ")}`.trim()) : p.text?.trim() || plan.title;
    const [content] = await createPosts({
      accountIds: [p.accountId],
      text,
      title: plan.title.slice(0, 100),
      tags: plan.tags?.slice(0, 15),
      media,
      options: { [VIDEO_TARGETS[target].platform]: options },
      // YouTube は今すぐ非公開でアップロードして予約公開（publishAt）。TikTok / Instagram は API に予約が無いので指定日時に送る
      scheduledAt: youtube ? new Date() : at,
      category: "video",
      extraMetadata: { videoEpisodeId: ep.id, videoTarget: target },
    });
    created.push({ target, contentId: content.id, accountId: p.accountId, publishAt: at.toISOString() });
  }
  const publishPlan = { ...plan, posts: created, approvedAt: new Date().toISOString() };
  await recordApproval(ep, "D", plan.note?.trim() || null, by, { publishPlan: publishPlan as unknown as Prisma.InputJsonValue, title: plan.title.slice(0, 200), status: "done" }, "scheduled");
  return getEpisodeView(id);
}

// --- 止める・再開・中止 ------------------------------------------------------------------

export async function setEpisodeStatus(id: string, action: "pause" | "resume" | "cancel") {
  const ep = await loadEpisode(id);
  if (ep.status === "done") throw new ConfigError("投稿予約済みのエピソードは変更できません");
  if (action === "pause") await prisma.videoEpisode.update({ where: { id }, data: { status: "paused" } });
  if (action === "cancel") {
    await prisma.videoEpisode.update({ where: { id }, data: { status: "cancelled" } });
    await prisma.videoJob.updateMany({ where: { episodeId: id, status: "queued" }, data: { status: "failed", error: "エピソードを中止しました", finishedAt: new Date() } });
  }
  if (action === "resume") {
    if (ep.status === "cancelled") throw new ConfigError("中止したエピソードは再開できません");
    const limits = await getVideoLimits();
    const cost = await episodeCost(id);
    if (overBudget(cost.amounts, limits.episodeBudget, limits.currency)) throw new ConfigError(`費用が 1 本あたりの上限（${limits.episodeBudget} ${limits.currency}）を超えています。設定 > 動画 で上限を見直してから再開してください`);
    await prisma.videoEpisode.update({ where: { id }, data: { status: "active", report: Prisma.JsonNull } });
    await resumePendingWork(id);
  }
  return getEpisodeView(id);
}

/** 止まっていた工程を再開する（失敗したジョブを今の工程から依頼し直す） */
async function resumePendingWork(id: string) {
  const ep = await loadEpisode(id);
  const sl = readShotlist(ep);
  const at = Date.now();
  if (ep.stage === "topics") await enqueueVideoJob(id, "topics", null, { resume: at });
  else if (ep.stage === "script") await enqueueVideoJob(id, "script", null, { resume: at });
  else if (ep.stage === "narration") await enqueueVideoJob(id, "narration", null, { resume: at });
  else if (ep.stage === "storyboard") {
    for (const s of sl.shots.filter((x) => !x.assets.storyboard)) await enqueueVideoJob(id, "storyboard", s.shot_id, { retries: s.qc.retries, resume: at });
    await maybeFinishImageStage(id, "storyboard");
  } else if (ep.stage === "final") {
    for (const s of sl.shots.filter((x) => x.status === "storyboard_ok" && !x.assets.final_image)) await enqueueVideoJob(id, "final", s.shot_id, { retries: s.qc.retries, resume: at });
    if (sl.shots.every((s) => s.status !== "storyboard_ok")) await enterVideoStage(ep);
  } else if (ep.stage === "render" && !((ep.thumbnails ?? []) as unknown[]).length) await enqueueVideoJob(id, "thumbnails", null, { resume: at });
}

/** 画面の「最新の報告を確認済みにする」 */
export async function dismissReport(id: string) {
  await prisma.videoEpisode.update({ where: { id }, data: { report: Prisma.JsonNull } });
  return getEpisodeView(id);
}

