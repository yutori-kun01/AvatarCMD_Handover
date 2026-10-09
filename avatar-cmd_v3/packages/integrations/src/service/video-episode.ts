// ================================================
// 動画パイプライン — エピソードの読み書き・費用・人への報告（工程とジョブの共通部品）
// ================================================

import { prisma, type Prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { costOfRow, loadPrices, usageMonthRange } from "./usage";
import { normalizeShotlist, type Shot, type Shotlist } from "./video-shotlist";
import type { VideoLimits } from "./video-config";

/** 工程。gate が付いた工程では人の承認を待つ（承認が無い限り次へ進まない） */
export const STAGES = [
  { id: "topics", label: "ネタ候補の作成" },
  { id: "approve_topic", label: "承認A: ネタ選定", gate: "A" },
  { id: "script", label: "台本とカット指示書の生成" },
  { id: "approve_script", label: "承認B: 台本確認", gate: "B" },
  { id: "narration", label: "ナレーション生成" },
  { id: "storyboard", label: "絵コンテ生成・検品" },
  { id: "approve_storyboard", label: "承認C: 絵コンテ承認", gate: "C" },
  { id: "final", label: "本番画像の生成・検品" },
  { id: "video", label: "動画化（i2v）" },
  { id: "render", label: "編集・書き出し・サムネイル" },
  { id: "approve_publish", label: "承認D: 公開前の最終確認", gate: "D" },
  { id: "scheduled", label: "投稿予約済み" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export function stageLabel(id: string): string {
  return STAGES.find((s) => s.id === id)?.label ?? id;
}

export type EpisodeRow = Prisma.VideoEpisodeGetPayload<object>;

export interface EpisodeReport {
  /** 何が起きたか（1 行） */
  what: string;
  /** どのエピソード・カットか */
  where: string;
  /** 試したこと */
  tried: string;
  /** 人に決めてほしいこと（選択肢 2〜3 個） */
  choices: string[];
  at: string;
}

export function readShotlist(ep: Pick<EpisodeRow, "shotlist" | "episodeKey">): Shotlist {
  return normalizeShotlist(ep.shotlist ?? {}, ep.episodeKey);
}

/** カット指示書を保存し、更新履歴を残す */
export async function saveShotlist(episodeId: string, sl: Shotlist, step: string, reason: string | null, by = "system", extra: Prisma.VideoEpisodeUpdateInput = {}) {
  await prisma.$transaction([
    prisma.videoEpisode.update({ where: { id: episodeId }, data: { ...extra, shotlist: sl as unknown as Prisma.InputJsonValue } }),
    prisma.videoShotlistRevision.create({ data: { episodeId, step, reason, by, shotlist: sl as unknown as Prisma.InputJsonValue } }),
  ]);
}

/**
 * 最新のカット指示書を行ロックして読み、fn で変えて保存する（同時に走る別カットのジョブの更新を消さないため）。
 * 読み直してから変えるので、呼び出し側は古い指示書を丸ごと書き戻さないこと。
 */
export async function mutateShotlist(
  episodeId: string,
  fn: (sl: Shotlist, ep: EpisodeRow) => Shotlist,
  step: string,
  reason: string | null,
  by = "system",
  extra: Prisma.VideoEpisodeUpdateInput = {}
): Promise<Shotlist> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM video_episodes WHERE id = ${episodeId} FOR UPDATE`;
    const ep = await tx.videoEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    const sl = fn(readShotlist(ep), ep);
    await tx.videoEpisode.update({ where: { id: episodeId }, data: { ...extra, shotlist: sl as unknown as Prisma.InputJsonValue } });
    await tx.videoShotlistRevision.create({ data: { episodeId, step, reason, by, shotlist: sl as unknown as Prisma.InputJsonValue } });
    return sl;
  });
}

/** 1 カットを置き換えて保存する */
export async function updateShot(episodeId: string, shotId: string, fn: (s: Shot) => Shot, step: string, reason: string | null, by = "system"): Promise<Shotlist> {
  return mutateShotlist(
    episodeId,
    (sl) => {
      const idx = sl.shots.findIndex((s) => s.shot_id === shotId);
      if (idx < 0) throw new ConfigError(`カット ${shotId} が見つかりません`);
      sl.shots[idx] = fn(sl.shots[idx]);
      return sl;
    },
    step,
    reason,
    by
  );
}

/** 人への報告を残し、必要ならエピソードを止める（指示書 10-4 の形式） */
export async function reportToHuman(ep: Pick<EpisodeRow, "id" | "avatarId" | "episodeKey">, r: Omit<EpisodeReport, "at">, opts: { pause?: boolean; level?: "warning" | "error" } = {}) {
  const report: EpisodeReport = { ...r, at: new Date().toISOString() };
  await prisma.videoEpisode.update({ where: { id: ep.id }, data: { report: report as unknown as Prisma.InputJsonValue, ...(opts.pause ? { status: "paused" } : {}) } });
  await prisma.activityLog
    .create({
      data: {
        avatarId: ep.avatarId,
        action: "video_report",
        category: "video",
        level: opts.level ?? "warning",
        description: `動画 ${ep.episodeKey}: ${r.what}`,
        metadata: { episodeId: ep.id, ...report } as unknown as Prisma.InputJsonValue,
      },
    })
    .catch(() => undefined);
}

// --- 費用 -------------------------------------------------------------------------

/** エピソードの費用（台帳の subjectId = エピソード ID の行を料金表で計算）。通貨ごと・未算定の行数 */
export async function episodeCost(episodeId: string): Promise<{ amounts: Record<string, number>; unpricedRows: number; calls: number }> {
  const rows = await prisma.usageLedger.findMany({ where: { subjectId: episodeId } });
  return sumCost(rows);
}

/** 今月の動画の費用（context = video の行） */
export async function monthlyVideoCost(now = new Date()) {
  const { from, to } = usageMonthRange(now);
  const rows = await prisma.usageLedger.findMany({ where: { context: "video", occurredAt: { gte: from, lt: to } } });
  return sumCost(rows);
}

async function sumCost(rows: Awaited<ReturnType<typeof prisma.usageLedger.findMany>>) {
  const prices = await loadPrices();
  const amounts: Record<string, number> = {};
  let unpricedRows = 0;
  for (const r of rows) {
    const c = costOfRow(r, prices);
    for (const [cur, v] of Object.entries(c.amounts)) amounts[cur] = (amounts[cur] ?? 0) + v;
    if (c.unpriced.length) unpricedRows++;
  }
  return { amounts, unpricedRows, calls: rows.length };
}

/** 費用が上限を超えているか（上限の通貨で比べる。料金表に無い通貨は数えない） */
export function overBudget(amounts: Record<string, number>, limit: number, currency: VideoLimits["currency"]): boolean {
  return limit > 0 && (amounts[currency] ?? 0) >= limit;
}

/** 2 つの文の似ている度合い（0〜1。文字 2-gram の Dice 係数）。タイトルの使い回しの検出に使う */
export function textSimilarity(a: string, b: string): number {
  const grams = (t: string) => {
    const c = t.replace(/\s/g, "");
    const m = new Map<string, number>();
    for (let i = 0; i < c.length - 1; i++) m.set(c.slice(i, i + 2), (m.get(c.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  const na = [...ga.values()].reduce((x, y) => x + y, 0);
  const nb = [...gb.values()].reduce((x, y) => x + y, 0);
  if (!na || !nb) return 0;
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  return (2 * hit) / (na + nb);
}
