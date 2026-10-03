import { NextResponse } from "next/server";
import { saveBudget, type BudgetConfig } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 予算: { amount: number | null, currency, warnRatio(0〜1), action: "warn" | "stop" }
export const PUT = route(async (req: Request) => {
  await saveBudget((await req.json()) as Partial<BudgetConfig>);
  return NextResponse.json({ ok: true });
});
