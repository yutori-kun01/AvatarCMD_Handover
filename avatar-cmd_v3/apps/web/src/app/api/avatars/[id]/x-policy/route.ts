// アバターの X API 利用方針（モード・カスタマイズ・予算）と今月の使用量
import { NextResponse } from "next/server";
import { effectiveXPolicy, estimateXMonthly, saveXPolicy, X_MODES, type XPolicySetting } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function view(id: string) {
  const e = await effectiveXPolicy(id);
  return {
    ...e,
    // 各モードの月額の見積もり（1 日 2 投稿）
    modes: Object.fromEntries(Object.entries(X_MODES).map(([k, m]) => [k, { ...m, estimate: estimateXMonthly(m.params, e.pricing) }])),
    customEstimate: estimateXMonthly(e.setting.custom, e.pricing),
  };
}

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json(await view(id));
});

export const PUT = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await saveXPolicy(id, (await req.json()) as Partial<XPolicySetting>);
  return NextResponse.json(await view(id));
});
