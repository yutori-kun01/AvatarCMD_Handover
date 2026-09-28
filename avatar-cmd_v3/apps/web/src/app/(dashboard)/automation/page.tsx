"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Play, Trash2 } from "lucide-react";
import { EmptyState, relTime, Shell } from "@/components/dashboard/shell";
import { api, Badge, Button, Card, Field, inputCls, LastError, Notice, type AccountInfo, type PlatformInfo } from "@/components/settings/ui";
import { PlatformIcon } from "@/components/platform-icon";

interface Rule {
  id: string;
  avatarId: string;
  avatarName: string;
  name: string;
  description: string | null;
  isActive: boolean;
  trigger: { type: "daily"; times: string[]; timezone?: string } | { type: "interval"; hours: number };
  action: { accountIds: string[]; topics: string[]; mode: "draft" | "auto"; extraPrompt?: string };
  executionCount: number;
  lastExecutedAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  performance: Performance | null;
}

type Verdict = "continue" | "improve" | "stop" | "insufficient";
interface Performance {
  verdict: Verdict;
  focus: "hook" | "topic" | "format" | "timing" | "length" | "none" | null;
  confidence: number | null;
  engine: string;
  stats: {
    posts: number;
    baselinePosts: number;
    basis: "rate" | "count";
    ratio: number | null;
    baseline: "other" | "trend";
    byTopic: { topic: string; posts: number; median: number | null }[];
    byHour: { hour: number; posts: number; median: number | null }[];
  } | null;
  createdAt: string;
}

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  continue: { label: "継続", cls: "bg-emerald-500/15 text-emerald-300" },
  improve: { label: "改善", cls: "bg-amber-500/15 text-amber-300" },
  stop: { label: "停止を検討", cls: "bg-red-500/15 text-red-300" },
  insufficient: { label: "データ不足", cls: "bg-white/10 text-white/50" },
};
const FOCUS: Record<string, string> = {
  hook: "書き出し（最初の一文）",
  topic: "トピック選び",
  format: "形式（箇条書き・質問・体験談など）",
  timing: "投稿時間帯",
  length: "長さ",
  none: "特になし",
};

function PerformanceBlock({ p }: { p: Performance }) {
  const s = p.stats;
  const fmt = (x: number | null) => (x === null ? "—" : s?.basis === "rate" ? `${(x * 100).toFixed(1)}%` : x.toFixed(1));
  const topics = [...(s?.byTopic ?? [])].filter((t) => t.median !== null).sort((a, b) => (b.median ?? 0) - (a.median ?? 0));
  return (
    <div className="mt-3 space-y-1 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={VERDICT[p.verdict].cls}>{VERDICT[p.verdict].label}</Badge>
        {p.focus && p.focus !== "none" && <span className="text-white/70">改善ポイント: {FOCUS[p.focus]}</span>}
        <span className="flex-1" />
        <span className="text-[11px] text-white/35">
          {p.engine === "jev" ? `Jev 判定${p.confidence !== null ? `（確信度 ${Math.round(p.confidence * 100)}%）` : ""}` : "ルール判定"}・{relTime(p.createdAt)}
        </span>
      </div>
      {s && (
        <div className="text-white/50">
          {s.baseline === "trend" ? "このルールの前半と比べた後半" : `同じアバターの他の投稿（${s.baselinePosts}件）と比べて`}：
          {s.ratio === null ? " 比較できる投稿が足りません" : ` ${s.ratio >= 1 ? "+" : ""}${Math.round((s.ratio - 1) * 100)}%`}（指標あり {s.posts} 件・
          {s.basis === "rate" ? "反応率" : "反応数"}で比較）
        </div>
      )}
      {topics.length > 1 && (
        <div className="text-white/40">
          トピック別: {topics.map((t) => `${t.topic} ${fmt(t.median)}（${t.posts}件）`).join(" / ")}
        </div>
      )}
    </div>
  );
}

interface Draft {
  id?: string;
  avatarId: string;
  name: string;
  triggerType: "daily" | "interval";
  times: string;
  hours: string;
  accountIds: string[];
  topics: string;
  mode: "draft" | "auto";
  extraPrompt: string;
}

function toDraft(r: Rule): Draft {
  return {
    id: r.id,
    avatarId: r.avatarId,
    name: r.name,
    triggerType: r.trigger.type,
    times: r.trigger.type === "daily" ? r.trigger.times.join(", ") : "09:00",
    hours: r.trigger.type === "interval" ? String(r.trigger.hours) : "6",
    accountIds: r.action.accountIds,
    topics: r.action.topics.join("\n"),
    mode: r.action.mode,
    extraPrompt: r.action.extraPrompt ?? "",
  };
}

function scheduleLabel(t: Rule["trigger"]) {
  return t.type === "daily" ? `毎日 ${t.times.join(" / ")}（${t.timezone ?? "Asia/Tokyo"}）` : `${t.hours}時間ごと`;
}

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [avatars, setAvatars] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [aiReady, setAiReady] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => {
    const [r, i] = await Promise.all([
      api<{ rules: Rule[] }>("/api/automations"),
      api<{ avatars: { id: string; name: string }[]; accounts: AccountInfo[]; platforms: PlatformInfo[]; ai: { ready: boolean } }>("/api/integrations"),
    ]);
    setRules(r.rules);
    setAvatars(i.avatars);
    setAccounts(i.accounts);
    setPlatforms(i.platforms);
    setAiReady(i.ai.ready);
  }, []);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", msg: e.message }));
  }, [load]);

  const byId = useMemo(() => Object.fromEntries(platforms.map((p) => [p.id, p])), [platforms]);
  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${byId[a.platform]?.name ?? ""} ${a.accountName}` : "(削除済み)";
  };

  async function save() {
    if (!draft) return;
    setBusy("save");
    const body = {
      avatarId: draft.avatarId,
      name: draft.name,
      trigger:
        draft.triggerType === "daily"
          ? { type: "daily", times: draft.times.split(/[,、\s]+/).filter(Boolean), timezone: "Asia/Tokyo" }
          : { type: "interval", hours: Number(draft.hours) },
      action: { accountIds: draft.accountIds, topics: draft.topics.split("\n"), mode: draft.mode, extraPrompt: draft.extraPrompt },
    };
    try {
      if (draft.id) await api(`/api/automations/${draft.id}`, { method: "PATCH", json: body });
      else await api("/api/automations", { method: "POST", json: body });
      setNotice({ kind: "ok", msg: "ルールを保存しました" });
      setDraft(null);
      load();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(id);
    try {
      await fn();
      setNotice({ kind: "ok", msg: okMsg });
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setBusy(null);
      load();
    }
  }

  const avatarAccounts = draft ? accounts.filter((a) => a.avatarId === draft.avatarId && byId[a.platform]?.support !== "manual") : [];

  return (
    <Shell title="自動化ルール" description="AI で投稿文を生成し、下書き作成または自動投稿">
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      {!aiReady && (
        <Notice kind="error">
          AI の API キー（Claude / OpenAI / Gemini）が未設定のため、ルールを実行すると失敗します。{" "}
          <Link href="/settings?tab=system" className="underline">
            設定 → システム
          </Link>{" "}
          で入力してください。
        </Notice>
      )}

      {draft ? (
        <Card className="mb-6 space-y-4">
          <h3 className="text-sm font-semibold">{draft.id ? "ルールを編集" : "新しいルール"}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field def={{ key: "name", label: "ルール名", required: true, placeholder: "朝の投稿" }} value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <label className="block">
              <span className="mb-1 block text-xs text-white/60">アバター</span>
              <select
                value={draft.avatarId}
                disabled={!!draft.id}
                onChange={(e) => setDraft({ ...draft, avatarId: e.target.value, accountIds: [] })}
                className={inputCls}
              >
                {avatars.map((a) => (
                  <option key={a.id} value={a.id} className="bg-[#111]">
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              def={{ key: "t", label: "実行タイミング", type: "select", options: [{ value: "daily", label: "毎日決まった時刻" }, { value: "interval", label: "一定間隔" }] }}
              value={draft.triggerType}
              onChange={(v) => setDraft({ ...draft, triggerType: v as Draft["triggerType"] })}
            />
            {draft.triggerType === "daily" ? (
              <Field def={{ key: "times", label: "時刻（日本時間・カンマ区切り）", placeholder: "09:00, 19:00" }} value={draft.times} onChange={(v) => setDraft({ ...draft, times: v })} />
            ) : (
              <Field def={{ key: "hours", label: "間隔（時間）", placeholder: "6" }} value={draft.hours} onChange={(v) => setDraft({ ...draft, hours: v })} />
            )}
            <Field
              def={{ key: "mode", label: "生成後の動作", type: "select", options: [{ value: "draft", label: "下書き（承認してから投稿）" }, { value: "auto", label: "そのまま自動投稿" }] }}
              value={draft.mode}
              onChange={(v) => setDraft({ ...draft, mode: v as Draft["mode"] })}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">投稿先アカウント</div>
            {avatarAccounts.length === 0 ? (
              <p className="text-xs text-amber-300">
                このアバターには投稿できるアカウントがありません。
                <Link href="/settings?tab=accounts" className="underline">
                  アカウントを接続
                </Link>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {avatarAccounts.map((a) => {
                  const on = draft.accountIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      onClick={() => setDraft({ ...draft, accountIds: on ? draft.accountIds.filter((x) => x !== a.id) : [...draft.accountIds, a.id] })}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${on ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60"}`}
                    >
                      <PlatformIcon platform={a.platform} /> {a.accountName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Field
            def={{ key: "topics", label: "トピック（1行に1つ。実行ごとに順番に使います）", type: "textarea", placeholder: "朝のルーティン\n集中力を保つコツ" }}
            value={draft.topics}
            onChange={(v) => setDraft({ ...draft, topics: v })}
          />
          <Field def={{ key: "extra", label: "追加の指示（任意）", placeholder: "最後に質問を投げかけて終える" }} value={draft.extraPrompt} onChange={(v) => setDraft({ ...draft, extraPrompt: v })} />
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy === "save" || !draft.name.trim()}>
              {busy === "save" ? "保存中…" : "保存"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              キャンセル
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          className="mb-6"
          disabled={!avatars.length}
          onClick={() =>
            setDraft({ avatarId: avatars[0]?.id ?? "", name: "", triggerType: "daily", times: "09:00", hours: "6", accountIds: [], topics: "", mode: "draft", extraPrompt: "" })
          }
        >
          + 新しいルール
        </Button>
      )}

      {rules.length === 0 ? (
        <EmptyState>自動化ルールはまだありません。「新しいルール」から作成してください。</EmptyState>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <Card key={r.id} className={r.isActive ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.name}</span>
                    <Badge className="bg-white/5 text-white/50">{r.avatarName}</Badge>
                    <Badge className={r.action.mode === "auto" ? "bg-violet-500/15 text-violet-300" : "bg-cyan-500/15 text-cyan-300"}>
                      {r.action.mode === "auto" ? "自動投稿" : "下書き→承認"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-white/50">{scheduleLabel(r.trigger)}</div>
                  <div className="mt-1 text-xs text-white/50">投稿先: {r.action.accountIds.map(accountName).join("、")}</div>
                  <div className="mt-1 text-xs text-white/40">トピック: {r.action.topics.join(" / ")}</div>
                  <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-white/35">
                    <span>実行 {r.executionCount}回</span>
                    <span>最終 {relTime(r.lastExecutedAt)}</span>
                    <span>次回 {r.isActive && r.nextRunAt ? new Date(r.nextRunAt).toLocaleString("ja-JP") : "—"}</span>
                  </div>
                  {r.lastError && (
                    <LastError
                      message={r.lastError}
                      onDismiss={() => act(r.id, () => api(`/api/automations/${r.id}`, { method: "PATCH", json: { clearError: true } }), "エラー表示を消しました")}
                    />
                  )}
                  {r.performance && <PerformanceBlock p={r.performance} />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => act(r.id, () => api(`/api/automations/${r.id}`, { method: "PATCH", json: { isActive: !r.isActive } }), r.isActive ? "停止しました" : "再開しました")}
                    className={`relative h-6 w-11 rounded-full transition ${r.isActive ? "bg-emerald-500" : "bg-white/15"}`}
                    title={r.isActive ? "停止" : "再開"}
                  >
                    <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all ${r.isActive ? "left-[23px]" : "left-[3px]"}`} />
                  </button>
                  <Button
                    variant="ghost"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, () => api(`/api/automations/${r.id}/run`, { method: "POST" }), "実行しました（投稿ページで結果を確認できます）")}
                  >
                    <Play className="inline h-3 w-3" /> {busy === r.id ? "実行中…" : "今すぐ実行"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy === `perf:${r.id}`}
                    onClick={() => act(`perf:${r.id}`, () => api(`/api/automations/${r.id}/performance`, { method: "POST" }), "反応を分析しました")}
                  >
                    <BarChart3 className="inline h-3 w-3" /> {busy === `perf:${r.id}` ? "分析中…" : "改善か継続かを分析"}
                  </Button>
                  <Button variant="ghost" onClick={() => setDraft(toDraft(r))}>
                    編集
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => confirm(`「${r.name}」を削除しますか？`) && act(r.id, () => api(`/api/automations/${r.id}`, { method: "DELETE" }), "削除しました")}
                  >
                    <Trash2 className="inline h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
