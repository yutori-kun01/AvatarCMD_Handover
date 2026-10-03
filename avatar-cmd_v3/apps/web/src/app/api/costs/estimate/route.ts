import { NextResponse } from "next/server";
import { estimateRuleConfig, type ActionConfig, type TriggerConfig } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 保存前のルール設定で、追加（変更）した場合の月額の増分を見積もる
export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { name?: string; avatarId?: string; trigger: TriggerConfig; action: ActionConfig };
  return NextResponse.json({ item: await estimateRuleConfig(b) });
});
