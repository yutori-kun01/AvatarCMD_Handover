// プラットフォーム × ジャンルの傾向（運用側のノウハウ）: 一覧（GET）・生成に使うかの切り替え（PUT）・今すぐ集計（POST）
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import {
  ALL_GENRES,
  GENRE_KEYS,
  GENRES,
  getPlaybookMode,
  getSetting,
  INSIGHT_RULES,
  INSIGHT_SETTING_KEYS,
  listPlatformInsights,
  PLAYBOOK_RULES,
  recomputePlatformInsights,
  setPlaybookMode,
} from "@avatar-cmd/integrations/server";
import { getPlatform } from "@avatar-cmd/integrations";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function describe(url: URL) {
  const platform = url.searchParams.get("platform") || undefined;
  const genre = url.searchParams.get("genre") || undefined;
  const [insights, mode, computedAt, platforms, genreCounts] = await Promise.all([
    listPlatformInsights({ platform, genre }),
    getPlaybookMode(),
    getSetting(INSIGHT_SETTING_KEYS.computedAt),
    prisma.platformInsight.findMany({ distinct: ["platform"], select: { platform: true } }),
    prisma.avatar.groupBy({ by: ["genre"], _count: { _all: true } }),
  ]);
  return {
    insights,
    mode,
    computedAt: computedAt ?? null,
    rules: { ...INSIGHT_RULES, playbook: PLAYBOOK_RULES },
    platforms: platforms.map((p) => ({ value: p.platform, label: getPlatform(p.platform)?.name ?? p.platform })),
    genres: [{ value: ALL_GENRES, label: "全ジャンル" }, ...GENRE_KEYS.map((k) => ({ value: k, label: GENRES[k].label }))],
    /** ジャンルごとのアバター数（未判定は genre: null） */
    avatarsByGenre: genreCounts.map((g) => ({ genre: g.genre, count: g._count._all })),
  };
}

export const GET = route(async (req: Request) => NextResponse.json(await describe(new URL(req.url))));

export const PUT = route(async (req: Request) => {
  const b = (await req.json()) as { mode?: string };
  await setPlaybookMode(String(b.mode ?? ""));
  return NextResponse.json(await describe(new URL(req.url)));
});

export const POST = route(async (req: Request) => {
  const result = await recomputePlatformInsights();
  return NextResponse.json({ result, ...(await describe(new URL(req.url))) });
});
