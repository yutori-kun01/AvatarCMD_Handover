// システム設定（公開URL・APIバージョン・AIキー・用途ごとの AI 割り当て）
import { NextResponse } from "next/server";
import { AI_PROVIDERS, isAiProvider, isAiTask, JEV_MODES, saveAiTask, setSetting, SETTING_KEYS, type AiProvider, type AiTask } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PUT = route(async (req: Request) => {
  const b = (await req.json()) as Record<string, string | undefined> & {
    /** プロバイダごとの API キー。空欄 = 変更しない、"-" = 削除 */
    aiKeys?: Record<string, string | undefined>;
    /** 用途ごとの割り当て。provider: "auto" | anthropic | openai | gemini */
    aiTasks?: Record<string, { provider?: string; model?: string }>;
    /** TypeSafe Jev 判定レイヤー。apiKey: 空欄 = 変更しない、"-" = 削除 */
    jev?: { apiKey?: string; model?: string; mode?: string };
  };
  if (b.appUrl !== undefined) {
    const v = b.appUrl.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\/[^/]+/.test(v)) return NextResponse.json({ error: "公開URLは http(s):// から始めてください" }, { status: 400 });
    await setSetting(SETTING_KEYS.appUrl, v || null);
  }
  if (b.metaGraphVersion !== undefined) {
    const v = b.metaGraphVersion.trim();
    if (v && !/^v\d+\.\d+$/.test(v)) return NextResponse.json({ error: "Graph API バージョンは v26.0 の形式で入力してください" }, { status: 400 });
    await setSetting(SETTING_KEYS.metaGraphVersion, v || null);
  }
  if (b.linkedinVersion !== undefined) {
    const v = b.linkedinVersion.trim();
    if (v && !/^\d{6}$/.test(v)) return NextResponse.json({ error: "LinkedIn-Version は YYYYMM の形式で入力してください" }, { status: 400 });
    await setSetting(SETTING_KEYS.linkedinVersion, v || null);
  }
  const tasks: [AiTask, AiProvider | "auto", string][] = [];
  for (const [task, cfg] of Object.entries(b.aiTasks ?? {})) {
    if (!isAiTask(task)) continue;
    const provider = cfg.provider?.trim() || "auto";
    if (provider !== "auto" && !isAiProvider(provider)) return NextResponse.json({ error: `AI プロバイダが不正です: ${provider}` }, { status: 400 });
    const model = cfg.model?.trim() ?? "";
    if (model && !/^[a-z0-9._\-]+$/i.test(model)) return NextResponse.json({ error: `モデル名が不正です: ${model}` }, { status: 400 });
    tasks.push([task, provider as AiProvider | "auto", model]);
  }
  if (b.jev) {
    const mode = b.jev.mode?.trim();
    if (mode && !JEV_MODES.includes(mode as never)) return NextResponse.json({ error: `判定モードが不正です: ${mode}` }, { status: 400 });
    const model = b.jev.model?.trim();
    if (model && !/^[a-z0-9._\-]+$/i.test(model)) return NextResponse.json({ error: `Jev のモデル名が不正です: ${model}` }, { status: 400 });
    if (mode !== undefined) await setSetting(SETTING_KEYS.jevMode, mode || null);
    if (model !== undefined) await setSetting(SETTING_KEYS.jevModel, model || null);
    const key = b.jev.apiKey?.trim();
    if (key) await setSetting(SETTING_KEYS.jevApiKey, key === "-" ? null : key);
  }
  for (const [provider, raw] of Object.entries(b.aiKeys ?? {})) {
    const v = raw?.trim();
    if (!isAiProvider(provider) || !v) continue;
    await setSetting(AI_PROVIDERS[provider].keySetting, v === "-" ? null : v);
  }
  for (const [task, provider, model] of tasks) await saveAiTask(task, provider, model);
  return NextResponse.json({ ok: true });
});
