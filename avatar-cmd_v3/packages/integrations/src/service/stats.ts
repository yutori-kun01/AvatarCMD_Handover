// ================================================
// ダッシュボード用の集計（すべて DB の実データから算出）
// ================================================
import { prisma } from "@avatar-cmd/db";
import { getPlatform } from "../platforms";
import { getSetting, SETTING_KEYS } from "./store";

const DAY = 24 * 3600_000;

function dayKey(d: Date, tz = "Asia/Tokyo") {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function systemStatus() {
  const beat = await getSetting(SETTING_KEYS.workerHeartbeat);
  const last = beat ? new Date(beat) : null;
  const [queued, failed24h, drafts] = await Promise.all([
    prisma.scheduledPost.count({ where: { status: { in: ["pending", "processing"] } } }),
    prisma.content.count({ where: { status: "FAILED", updatedAt: { gte: new Date(Date.now() - DAY) } } }),
    prisma.content.count({ where: { status: "DRAFT", snsAccountId: { not: null } } }),
  ]);
  return {
    workerAlive: !!last && Date.now() - last.getTime() < 2 * 60_000,
    workerLastSeen: last,
    queued,
    failed24h,
    drafts,
  };
}

export async function overview() {
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY);
  const since14 = new Date(now - 14 * DAY);
  const since30 = new Date(now - 30 * DAY);

  const [avatars, accounts, published30, published7, publishedPrev7, failed7, scheduled, drafts, rules, revenue30, revenuePrev30] =
    await Promise.all([
      prisma.avatar.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, role: true, status: true } }),
      prisma.snsAccount.findMany({ select: { id: true, avatarId: true, platform: true, accountName: true, isActive: true, lastError: true, tokenExpiry: true } }),
      prisma.content.findMany({ where: { status: "PUBLISHED", publishedAt: { gte: since30 } }, select: { avatarId: true, platform: true, publishedAt: true } }),
      prisma.content.count({ where: { status: "PUBLISHED", publishedAt: { gte: since7 } } }),
      prisma.content.count({ where: { status: "PUBLISHED", publishedAt: { gte: since14, lt: since7 } } }),
      prisma.content.count({ where: { status: "FAILED", updatedAt: { gte: since7 } } }),
      prisma.content.count({ where: { status: "SCHEDULED" } }),
      prisma.content.count({ where: { status: "DRAFT", snsAccountId: { not: null } } }),
      prisma.automationRule.findMany({ select: { isActive: true, nextRunAt: true, name: true } }),
      prisma.revenue.aggregate({ _sum: { amount: true }, where: { earnedAt: { gte: since30 }, status: { not: "refunded" } } }),
      prisma.revenue.aggregate({ _sum: { amount: true }, where: { earnedAt: { gte: new Date(now - 60 * DAY), lt: since30 }, status: { not: "refunded" } } }),
    ]);

  const change = (a: number, b: number) => (b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 1000) / 10);
  const successRate = published7 + failed7 === 0 ? null : Math.round((published7 / (published7 + failed7)) * 1000) / 10;

  // 日別投稿数（30日）
  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) byDay.set(dayKey(new Date(now - i * DAY)), 0);
  for (const c of published30) {
    const k = dayKey(c.publishedAt!);
    if (byDay.has(k)) byDay.set(k, byDay.get(k)! + 1);
  }

  const platformCounts = new Map<string, number>();
  for (const c of published30) platformCounts.set(c.platform, (platformCounts.get(c.platform) ?? 0) + 1);

  const avatarRows = avatars.map((a) => {
    const mine = accounts.filter((x) => x.avatarId === a.id);
    const posts = published30.filter((c) => c.avatarId === a.id);
    return {
      ...a,
      accounts: mine.map((m) => ({ platform: m.platform, name: getPlatform(m.platform)?.name ?? m.platform, icon: getPlatform(m.platform)?.icon ?? "", accountName: m.accountName, ok: m.isActive && !m.lastError })),
      posts30: posts.length,
      posts7: posts.filter((c) => c.publishedAt! >= since7).length,
    };
  });

  // 対応が必要なこと（実データから判定）
  const alerts: { level: "error" | "warning" | "info"; title: string; description: string; href: string }[] = [];
  if (!accounts.length) alerts.push({ level: "info", title: "SNSアカウントが未接続です", description: "設定 > アカウント から接続すると投稿できるようになります", href: "/settings?tab=accounts" });
  for (const a of accounts) {
    if (a.lastError && a.isActive) alerts.push({ level: "error", title: `${getPlatform(a.platform)?.name ?? a.platform} (${a.accountName}) でエラー`, description: a.lastError.slice(0, 200), href: "/settings?tab=accounts" });
    if (a.tokenExpiry && a.tokenExpiry.getTime() < now + 3 * DAY && !["x", "youtube", "reddit", "tiktok"].includes(a.platform)) {
      alerts.push({ level: "warning", title: `${getPlatform(a.platform)?.name} (${a.accountName}) のトークン期限が近づいています`, description: `期限: ${a.tokenExpiry.toLocaleString("ja-JP")}。期限後は再接続が必要です`, href: "/settings?tab=accounts" });
    }
  }
  if (drafts) alerts.push({ level: "info", title: `承認待ちの下書きが${drafts}件あります`, description: "投稿ページで内容を確認して承認してください", href: "/posts" });
  if (failed7) alerts.push({ level: "warning", title: `直近7日で${failed7}件の投稿が失敗しています`, description: "投稿ページでエラー内容を確認し、再送できます", href: "/posts" });

  const status = await systemStatus();
  if (!status.workerAlive) alerts.unshift({ level: "error", title: "worker が停止しています", description: "予約投稿・自動化が実行されません。worker コンテナ（pnpm dev では worker）を起動してください", href: "/settings?tab=system" });

  return {
    kpis: {
      published7,
      publishedChange: change(published7, publishedPrev7),
      successRate,
      accounts: accounts.filter((a) => a.isActive).length,
      scheduled,
      drafts,
      activeRules: rules.filter((r) => r.isActive).length,
      revenue30: revenue30._sum.amount ?? 0,
      revenueChange: change(revenue30._sum.amount ?? 0, revenuePrev30._sum.amount ?? 0),
    },
    daily: [...byDay.entries()].map(([date, count]) => ({ date, count })),
    platforms: [...platformCounts.entries()]
      .map(([p, count]) => ({ platform: p, name: getPlatform(p)?.name ?? p, icon: getPlatform(p)?.icon ?? "", count }))
      .sort((a, b) => b.count - a.count),
    avatars: avatarRows,
    alerts,
    status,
    nextRule: rules.filter((r) => r.isActive && r.nextRunAt).sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime())[0] ?? null,
  };
}

export async function revenueReport() {
  const rows = await prisma.revenue.findMany({
    orderBy: { earnedAt: "desc" },
    take: 500,
    include: { avatar: { select: { name: true } } },
  });
  const valid = rows.filter((r) => r.status !== "refunded");
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + r.amount, 0);
  const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, number>();
    for (const r of valid) m.set(key(r), (m.get(key(r)) ?? 0) + r.amount);
    return [...m.entries()].map(([k, total]) => ({ key: k, total })).sort((a, b) => b.total - a.total);
  };
  const monthKey = (d: Date) => dayKey(d).slice(0, 7);
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(monthKey(d));
  }
  const byMonth = new Map(group((r) => monthKey(r.earnedAt)).map((x) => [x.key, x.total]));
  return {
    total: sum(valid),
    byAvatar: group((r) => r.avatar.name),
    bySource: group((r) => r.source),
    byPlatform: group((r) => r.platform),
    monthly: months.map((m) => ({ month: m, total: byMonth.get(m) ?? 0 })),
    entries: rows.slice(0, 100).map((r) => ({
      id: r.id,
      avatarName: r.avatar.name,
      source: r.source,
      platform: r.platform,
      amount: r.amount,
      currency: r.currency,
      description: r.description,
      status: r.status,
      earnedAt: r.earnedAt,
    })),
  };
}
