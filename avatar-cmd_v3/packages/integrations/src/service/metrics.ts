// ================================================
// 投稿の反応（指標）の収集 — worker から定期実行
// ================================================
// ・X: 指定した投稿だけ（GET /2/tweets?ids=）。取得する時点はアバターの X API モード（例: 公開から 1h / 6h / 24h）で決め、
//   時点ごとの値を post_metric_snapshots に残す（1 件 $0.005 なので、決まった時点だけ読む）
// ・Threads: 投稿ごとのインサイト（フォロワー100人以上など Meta の条件あり。満たさない間は理由を記録してスキップ）
// 公開から 14 日間、若い投稿ほど頻繁に取得する（〜48時間: 6時間ごと / それ以降: 24時間ごと）。
// 取得結果は Content.engagement（{ views, likes, ..., engagements, engagementRate, fetchedAt } または { error }）に保存。

import { prisma } from "@avatar-cmd/db";
import type { PostMetrics } from "../types";
import { getPlatform } from "../platforms";
import { loadFreshCredentials } from "./accounts";
import { errorMessage } from "./publish";
import { getSystemConfig } from "./store";
import { recordUsage } from "./usage";
import { addPostDeltas } from "./analytics";
import { dueCheckpoint, effectiveXPolicy } from "./x-policy";

const HOUR = 3600_000;
export const METRICS_WINDOW_DAYS = 14;

/** 次に取得すべきか（公開からの経過時間で間隔を変える） */
export function metricsDue(publishedAt: Date, lastFetched: Date | null, now = new Date()): boolean {
  const age = now.getTime() - publishedAt.getTime();
  if (age < HOUR) return false; // 公開直後は数字が安定しないので1時間待つ
  if (age > METRICS_WINDOW_DAYS * 24 * HOUR) return false;
  if (!lastFetched) return true;
  const interval = age < 48 * HOUR ? 6 * HOUR : 24 * HOUR;
  return now.getTime() - lastFetched.getTime() >= interval;
}

/** 反応の合計（表示回数・ブックマークは除く）と反応率 */
export function summarizeMetrics(m: PostMetrics) {
  const engagements = (m.likes ?? 0) + (m.replies ?? 0) + (m.reposts ?? 0) + (m.quotes ?? 0) + (m.shares ?? 0);
  const engagementRate = m.views ? engagements / m.views : null;
  return { engagements, engagementRate };
}

/** 前回取得した指標からの増分（初回は公開からの全量。減った場合は 0） */
export function metricsDelta(prev: Record<string, unknown>, next: Record<string, unknown>): { views: number; engagements: number } {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { views: Math.max(0, n(next.views) - n(prev.views)), engagements: Math.max(0, n(next.engagements) - n(prev.engagements)) };
}

/** 期限の来た投稿の指標を取得する。取得した投稿数を返す */
export async function collectMetrics({ maxAccounts = 5 } = {}): Promise<number> {
  const now = new Date();
  const candidates = await prisma.content.findMany({
    where: {
      status: "PUBLISHED",
      externalPostId: { not: null },
      snsAccountId: { not: null },
      publishedAt: { gte: new Date(now.getTime() - METRICS_WINDOW_DAYS * 24 * HOUR), lte: new Date(now.getTime() - HOUR) },
      platform: { in: ["x", "threads"] },
    },
    select: { id: true, avatarId: true, platform: true, snsAccountId: true, externalPostId: true, publishedAt: true, metricsUpdatedAt: true, engagement: true, metricSnapshots: { select: { checkpoint: true } } },
    orderBy: { publishedAt: "desc" },
    take: 500,
  });
  // X は読み取りが有料なので、アバターの X API モードの時点（例: 1h / 6h / 24h）だけ取る。Threads は従来どおり
  const checkpointsByAvatar = new Map<string, number[]>();
  for (const avatarId of new Set(candidates.filter((c) => c.platform === "x").map((c) => c.avatarId))) {
    checkpointsByAvatar.set(avatarId, (await effectiveXPolicy(avatarId, now)).params.metricsCheckpoints);
  }
  const checkpointOf = new Map<string, number>();
  const due = candidates.filter((c) => {
    if (c.platform !== "x") return metricsDue(c.publishedAt!, c.metricsUpdatedAt, now);
    const cp = dueCheckpoint(c.publishedAt!, c.metricSnapshots.map((s) => s.checkpoint), checkpointsByAvatar.get(c.avatarId) ?? [], now);
    if (cp !== null) checkpointOf.set(c.id, cp);
    return cp !== null;
  });
  const byAccount = new Map<string, typeof due>();
  for (const c of due) byAccount.set(c.snsAccountId!, [...(byAccount.get(c.snsAccountId!) ?? []), c]);

  let updated = 0;
  const system = await getSystemConfig();
  for (const [accountId, rows] of [...byAccount].slice(0, maxAccounts)) {
    const acc = await prisma.snsAccount.findUnique({ where: { id: accountId } });
    const def = acc && getPlatform(acc.platform);
    if (!acc || !acc.isActive || !def?.fetchMetrics) continue;
    let results: Record<string, PostMetrics | { error: string }>;
    let accountFailed = false;
    try {
      const { credentials, app } = await loadFreshCredentials(acc.id);
      results = await def.fetchMetrics(
        { app, credentials, settings: (acc.settings ?? {}) as Record<string, unknown>, account: { accountId: acc.accountId ?? "", accountName: acc.accountName }, system },
        rows.map((r) => ({ postId: r.externalPostId!, publishedAt: r.publishedAt! }))
      );
    } catch (e) {
      // アカウント単位の失敗（クレジット不足・認証切れ）は全件に理由を残し、次の間隔まで待つ
      accountFailed = true;
      const msg = errorMessage(e).slice(0, 300);
      results = Object.fromEntries(rows.map((r) => [r.externalPostId!, { error: msg }]));
    }
    // 読み取り件数の概算（取得できた投稿数。X はページ単位で余分に読むことがあるため実際より少なめになりうる）
    const got = Object.values(results).filter((m) => !("error" in m)).length;
    await recordUsage({ provider: acc.platform, purpose: `${acc.platform}_metrics`, avatarId: acc.avatarId, context: "metrics", reads: got, error: got ? null : Object.values(results)[0] && "error" in Object.values(results)[0] ? (Object.values(results)[0] as { error: string }).error : null });
    // アカウントの日別の閲覧数・反応数（前回取得からの増分を今日に計上）。
    // 媒体がアカウント単位の日別閲覧数を返せる場合（Threads）は閲覧数を足さない（二重計上を防ぐ）
    const delta = { views: 0, engagements: 0 };
    for (const r of rows) {
      const m = results[r.externalPostId!];
      if (!m) continue;
      // 失敗時は前回取得できた数字を残したまま理由だけ更新する
      const prev = (r.engagement ?? {}) as Record<string, unknown>;
      const engagement = "error" in m ? { ...prev, error: m.error, errorAt: now.toISOString() } : { ...m, ...summarizeMetrics(m), fetchedAt: now.toISOString() };
      await prisma.content.update({ where: { id: r.id }, data: { engagement: engagement as object, metricsUpdatedAt: now } });
      const cp = checkpointOf.get(r.id);
      // アカウント単位の失敗（認証切れ・クレジット不足）は時点を記録せず、次の確認で取り直す
      if (cp !== undefined && !accountFailed) {
        // 失敗した時点も記録して、同じ時点を何度も読み直さない（読み取りは課金されうる）
        const ok = !("error" in m);
        const e = engagement as Record<string, unknown>;
        await prisma.postMetricSnapshot.upsert({
          where: { contentId_checkpoint: { contentId: r.id, checkpoint: cp } },
          create: { contentId: r.id, checkpoint: cp, views: ok && typeof e.views === "number" ? e.views : null, engagements: ok && typeof e.engagements === "number" ? e.engagements : null, metrics: (ok ? m : { error: m.error }) as object },
          update: {},
        });
      }
      if ("error" in m) continue;
      updated++;
      const d = metricsDelta(prev, engagement as Record<string, unknown>);
      delta.views += d.views;
      delta.engagements += d.engagements;
    }
    await addPostDeltas(accountId, { views: def.fetchInsights ? 0 : delta.views, engagements: delta.engagements }, now).catch((e) => console.warn(`[metrics] snapshot: ${errorMessage(e)}`));
  }
  return updated;
}
