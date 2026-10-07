// ================================================
// note 記事の生成ジョブ — 執筆・画像/図解・見出し画像をバックグラウンドで作る
// ================================================
// ・画面は enqueueArticleJob() で依頼して ID を受け取り、getArticleJob() で結果を見に来る（画面を閉じても生成は続く）。
// ・実行は worker（processArticleJobs を数秒ごとに呼ぶ）。worker が止まっているとき（心拍が古い）は web のプロセスで実行する。
// ・行の取り出しは status=queued → running の条件付き更新で行い、二重に実行しない。
// ・実行中のままプロセスが落ちたジョブは、一定時間で「中断」として失敗にする（画面から依頼し直せる）。

import { prisma, type Prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { withUsageContext } from "./usage";
import { generateEyecatch, generateNoteDraft, renderVisualMarkers, type NoteDraftInput } from "./article";
import { getSetting, SETTING_KEYS } from "./store";

export type ArticleJobKind = "write" | "render" | "eyecatch";
export type ArticleJobStatus = "queued" | "running" | "done" | "failed";

export interface ArticleJobInputs {
  write: Omit<NoteDraftInput, "avatarId">;
  render: { markdown: string; only?: number[] };
  eyecatch: { title: string; summary?: string };
}

export interface ArticleJobView {
  id: string;
  kind: ArticleJobKind;
  status: ArticleJobStatus;
  progress: string | null;
  result: unknown;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** 同時に実行する数（画像生成は 1 本に数分かかるため、プロセスごとに絞る） */
const CONCURRENCY = Number(process.env.ARTICLE_JOB_CONCURRENCY || 2);
/** running のまま進み具合がこれより長く更新されなければ、実行していたプロセスが落ちたとみなす */
const STALE_MS = 30 * 60_000;
/** worker の心拍がこれより古ければ、web で実行する */
const WORKER_ALIVE_MS = 90_000;

const running = new Set<string>();

function view(j: { id: string; kind: string; status: string; progress: string | null; result: unknown; error: string | null; createdAt: Date; finishedAt: Date | null }): ArticleJobView {
  return { id: j.id, kind: j.kind as ArticleJobKind, status: j.status as ArticleJobStatus, progress: j.progress, result: j.result, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt };
}

async function workerAlive(): Promise<boolean> {
  const beat = await getSetting(SETTING_KEYS.workerHeartbeat);
  return !!beat && Date.now() - new Date(beat).getTime() < WORKER_ALIVE_MS;
}

/** 生成を依頼する（すぐ戻る）。worker が動いていなければこのプロセスで始める */
export async function enqueueArticleJob<K extends ArticleJobKind>(kind: K, avatarId: string, input: ArticleJobInputs[K]): Promise<ArticleJobView> {
  if (!avatarId) throw new ConfigError("アバター（note アカウント）を選択してください");
  if (!["write", "render", "eyecatch"].includes(kind)) throw new ConfigError("ジョブの種類が不正です");
  const job = await prisma.articleJob.create({ data: { kind, avatarId, input: input as unknown as Prisma.InputJsonValue } });
  if (!(await workerAlive())) void runArticleJob(job.id);
  return view(job);
}

export async function getArticleJob(id: string): Promise<ArticleJobView | null> {
  const j = await prisma.articleJob.findUnique({ where: { id } });
  return j ? view(j) : null;
}

/** 最近のジョブ（画面の「生成中」表示用） */
export async function listArticleJobs(opts: { avatarId?: string; limit?: number } = {}): Promise<ArticleJobView[]> {
  const rows = await prisma.articleJob.findMany({ where: opts.avatarId ? { avatarId: opts.avatarId } : {}, orderBy: { createdAt: "desc" }, take: opts.limit ?? 20 });
  return rows.map(view);
}

/** 1 件実行する（取り出せなかった＝他で実行中なら何もしない） */
export async function runArticleJob(id: string): Promise<boolean> {
  if (running.has(id)) return false;
  const claimed = await prisma.articleJob.updateMany({ where: { id, status: "queued" }, data: { status: "running", startedAt: new Date(), progress: null } });
  if (!claimed.count) return false;
  running.add(id);
  try {
    const job = await prisma.articleJob.findUniqueOrThrow({ where: { id } });
    const input = job.input as any;
    const avatarId = job.avatarId ?? "";
    const progress = (text: string) => prisma.articleJob.update({ where: { id }, data: { progress: text } }).catch(() => undefined);
    let result: unknown;
    await withUsageContext({ context: "manual" }, async () => {
      if (job.kind === "write") {
        await progress("執筆中");
        result = await generateNoteDraft({ ...input, avatarId });
      } else if (job.kind === "render") {
        result = await renderVisualMarkers({ avatarId, markdown: String(input.markdown ?? ""), only: input.only, onProgress: (done, total) => progress(`${done} / ${total}`) });
      } else if (job.kind === "eyecatch") {
        await progress("生成中");
        result = { media: await generateEyecatch({ avatarId, title: String(input.title ?? ""), summary: input.summary }) };
      } else throw new Error(`不明なジョブ: ${job.kind}`);
    });
    await prisma.articleJob.update({ where: { id }, data: { status: "done", result: result as Prisma.InputJsonValue, finishedAt: new Date() } });
  } catch (e) {
    await prisma.articleJob
      .update({ where: { id }, data: { status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() } })
      .catch((err) => console.error("[article-jobs] failed to record error:", err));
  } finally {
    running.delete(id);
  }
  return true;
}

/**
 * 待っているジョブを取り出して始める（worker から数秒ごとに呼ぶ）。完了は待たずに戻り、始めた件数を返す。
 * 進み具合が長く更新されない running のジョブ（実行中にプロセスが落ちた）は失敗にする。
 */
export async function processArticleJobs(): Promise<number> {
  await prisma.articleJob.updateMany({
    where: { status: "running", updatedAt: { lt: new Date(Date.now() - STALE_MS) }, id: { notIn: [...running] } },
    data: { status: "failed", error: "生成が中断されました（サーバーの再起動など）。もう一度依頼してください", finishedAt: new Date() },
  });
  const free = CONCURRENCY - running.size;
  if (free <= 0) return 0;
  const queued = await prisma.articleJob.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: free, select: { id: true } });
  for (const q of queued) void runArticleJob(q.id);
  return queued.length;
}

/** 古いジョブを消す（結果は本文に反映済みのはずなので 7 日で十分） */
export async function pruneArticleJobs(days = 7): Promise<number> {
  const r = await prisma.articleJob.deleteMany({ where: { status: { in: ["done", "failed"] }, createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return r.count;
}
