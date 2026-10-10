// ================================================
// note 記事カレンダー — 作成予定・公開予定・保留中・公開済みを 1 か所にまとめる
// ================================================
// ・公開予定: 予約キューにある note 記事（scheduledAt）
// ・保留中: 自動化で保留した下書き（承認待ち）。予定時刻（plannedAt）があればその日に、無ければ今日に並べる
// ・作成予定: 有効な note 記事ルールの次回以降の実行時刻と、その回に使うテーマ
// ・公開済み: 直近 7 日に note へ入稿したもの

import { prisma } from "@avatar-cmd/db";
import { nextRunAfter, validateTrigger, type NoteArticleActionConfig, type TriggerConfig } from "./automation";
import { describeTiming } from "./article-gate";

export type CalendarKind = "creation" | "held" | "scheduled" | "published";

export interface CalendarItem {
  kind: CalendarKind;
  at: string;
  title: string;
  contentId?: string;
  ruleId?: string;
  ruleName?: string;
  accountName?: string;
  /** note の入稿のしかた（公開 / 下書き保存） */
  mode?: "publish" | "draft";
  price?: string;
  heldReason?: string;
  /** 本文の冒頭（プレビュー） */
  preview?: string;
  postUrl?: string | null;
  /** 作成予定の公開のタイミング */
  timing?: string;
}

export async function articleCalendar(opts: { avatarIds?: string[]; days?: number; now?: Date } = {}): Promise<CalendarItem[]> {
  const now = opts.now ?? new Date();
  const until = new Date(now.getTime() + (opts.days ?? 28) * 86400_000);
  const avatarFilter = opts.avatarIds ? { avatarId: { in: opts.avatarIds } } : {};
  const items: CalendarItem[] = [];
  const rules = await prisma.automationRule.findMany({ where: { ...avatarFilter, actionType: "note_article" }, select: { id: true, name: true, isActive: true, triggerConfig: true, actionConfig: true, executionCount: true, nextRunAt: true } });
  const ruleName = new Map(rules.map((r) => [r.id, r.name]));

  const contents = await prisma.content.findMany({
    where: {
      ...avatarFilter,
      platform: "note",
      OR: [
        { status: "SCHEDULED", scheduledPost: { status: "pending" } },
        { status: "DRAFT", category: "automation" },
        { status: "PUBLISHED", publishedAt: { gte: new Date(now.getTime() - 7 * 86400_000) } },
      ],
    },
    include: { scheduledPost: true, snsAccount: { select: { accountName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  for (const c of contents) {
    const meta = (c.metadata ?? {}) as Record<string, any>;
    // 手動で作った下書き（保留の理由が自動化のものでない）は並べない
    if (c.status === "DRAFT" && !(typeof meta.heldReason === "string" && meta.automationId)) continue;
    const planned = typeof meta.plannedAt === "string" ? new Date(meta.plannedAt) : null;
    const at = c.status === "SCHEDULED" ? c.scheduledPost!.scheduledAt : c.status === "PUBLISHED" ? c.publishedAt! : planned && planned.getTime() > now.getTime() ? planned : now;
    items.push({
      kind: c.status === "SCHEDULED" ? "scheduled" : c.status === "PUBLISHED" ? "published" : "held",
      at: at.toISOString(),
      title: String(meta.options?.title || meta.title || c.content.slice(0, 40)),
      contentId: c.id,
      ruleId: meta.automationId,
      ruleName: meta.automationId ? ruleName.get(meta.automationId) : undefined,
      accountName: c.snsAccount?.accountName,
      mode: meta.options?.mode === "publish" ? "publish" : "draft",
      price: meta.options?.price || undefined,
      heldReason: c.status === "DRAFT" ? meta.heldReason : undefined,
      preview: c.content.slice(0, 1200),
      postUrl: c.postUrl,
    });
  }

  // 作成予定（有効なルールの次回以降の実行。テーマは実行回数の順）
  for (const r of rules) {
    if (!r.isActive || !r.nextRunAt) continue;
    let trigger: TriggerConfig;
    try {
      trigger = validateTrigger(r.triggerConfig as unknown as TriggerConfig);
    } catch {
      continue;
    }
    const a = r.actionConfig as unknown as NoteArticleActionConfig;
    const topics = a.topics ?? [];
    // テーマ候補のキューがあれば先に使う（suggest は採用済みだけ、auto は提案も）
    const mode = a.autoTopics ?? "off";
    const queue =
      mode === "off"
        ? []
        : (await prisma.articleTopicSuggestion.findMany({ where: { ruleId: r.id, status: { in: mode === "auto" ? ["accepted", "proposed"] : ["accepted"] } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 60, select: { topic: true } })).map((q) => q.topic);
    let at = r.nextRunAt;
    for (let i = 0, rot = 0; i < 60 && at.getTime() <= until.getTime(); i++) {
      const title = i < queue.length ? queue[i] : topics.length ? topics[(r.executionCount + rot++) % topics.length] : null;
      if (title)
        items.push({
          kind: "creation",
          at: at.toISOString(),
          title,
          ruleId: r.id,
          ruleName: r.name,
          timing: describeTiming(a.publishTiming ?? { type: "now" }),
        });
      at = nextRunAfter(trigger, at);
    }
  }
  return items.sort((x, y) => x.at.localeCompare(y.at));
}
