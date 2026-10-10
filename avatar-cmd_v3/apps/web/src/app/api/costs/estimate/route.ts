import { NextResponse } from "next/server";
import { estimateNoteRuleConfig, estimateRuleConfig, type ActionConfig, type NoteArticleActionConfig, type TriggerConfig } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 保存前のルール設定で、追加（変更）した場合の月額の増分を見積もる
export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { name?: string; avatarId?: string; actionType?: string; trigger: TriggerConfig; action: ActionConfig | NoteArticleActionConfig };
  if (b.actionType === "note_article") return NextResponse.json({ item: await estimateNoteRuleConfig({ ...b, action: b.action as NoteArticleActionConfig }) });
  return NextResponse.json({ item: await estimateRuleConfig({ ...b, action: b.action as ActionConfig }) });
});
