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
  actionType: "generate_post" | "quote_post";
  action: {
    accountIds: string[];
    topics: string[];
    mode: "draft" | "auto";
    approval?: Approval;
    extraPrompt?: string;
    // 引用投稿ルール（quote_post）
    accountId?: string;
    scanPosts?: number;
    maxDrafts?: number;
    maxAgeHours?: number;
    sameAuthorCooldownDays?: number;
    excludeAuthors?: string[];
    allowReuseAcrossAvatars?: boolean;
  };
  executionCount: number;
  lastExecutedAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  performance: Performance | null;
}

type Approval = "all" | "standard" | "strict";
const APPROVAL: Record<Approval, { label: string; badge: string }> = {
  all: { label: "全自動：チェック結果に関わらず投稿（結果は記録のみ）", badge: "全自動" },
  standard: { label: "条件付き：NG・Jev の保留・判定障害だけ承認待ち", badge: "NGのみ保留" },
  strict: { label: "厳格：チェック OK かつ Jev 通過のみ投稿（判定障害も承認待ち）", badge: "OKのみ投稿" },
};

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
  actionType: Rule["actionType"];
  avatarId: string;
  name: string;
  triggerType: "daily" | "interval";
  times: string;
  hours: string;
  accountIds: string[];
  topics: string;
  mode: "draft" | "auto";
  /** 新規作成時は未選択（""）。自動投稿では選択必須 */
  approval: Approval | "";
  extraPrompt: string;
  // 引用投稿ルール
  quoteAccountId: string;
  scanPosts: string;
  maxDrafts: string;
  maxAgeHours: string;
  cooldownDays: string;
  excludeAuthors: string;
  allowReuse: boolean;
}

function toDraft(r: Rule): Draft {
  return {
    id: r.id,
    actionType: r.actionType ?? "generate_post",
    avatarId: r.avatarId,
    name: r.name,
    triggerType: r.trigger.type,
    times: r.trigger.type === "daily" ? r.trigger.times.join(", ") : "09:00",
    hours: r.trigger.type === "interval" ? String(r.trigger.hours) : "6",
    accountIds: r.action.accountIds ?? [],
    topics: (r.action.topics ?? []).join("\n"),
    mode: r.action.mode,
    // 下書きモードから自動投稿に切り替えるときは、承認範囲を改めて選んでもらう
    approval: r.action.mode === "auto" ? r.action.approval ?? "all" : "",
    extraPrompt: r.action.extraPrompt ?? "",
    quoteAccountId: r.action.accountId ?? "",
    scanPosts: String(r.action.scanPosts ?? 30),
    maxDrafts: String(r.action.maxDrafts ?? 3),
    maxAgeHours: String(r.action.maxAgeHours ?? 48),
    cooldownDays: String(r.action.sameAuthorCooldownDays ?? 7),
    excludeAuthors: (r.action.excludeAuthors ?? []).join(", "),
    allowReuse: !!r.action.allowReuseAcrossAvatars,
  };
}

const NEW_DRAFT: Omit<Draft, "avatarId"> = {
  actionType: "generate_post",
  name: "",
  triggerType: "daily",
  times: "09:00",
  hours: "6",
  accountIds: [],
  topics: "",
  mode: "draft",
  approval: "",
  extraPrompt: "",
  quoteAccountId: "",
  scanPosts: "30",
  maxDrafts: "3",
  maxAgeHours: "48",
  cooldownDays: "7",
  excludeAuthors: "",
  allowReuse: false,
};

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
  const [estimate, setEstimate] = useState<{ amounts: Record<string, number>; unpriced: string[]; runsPerMonth: number; notes: string[] } | null>(null);

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

  // 編集中の設定で、このルールの月額の増分（概算）を見積もる
  useEffect(() => {
    if (!draft || draft.actionType !== "generate_post" || !draft.accountIds.length || !draft.topics.trim()) return setEstimate(null);
    const t = setTimeout(() => {
      api<{ item: NonNullable<typeof estimate> }>("/api/costs/estimate", { method: "POST", json: ruleBody(draft) })
        .then((d) => setEstimate(d.item))
        .catch(() => setEstimate(null));
    }, 600);
    return () => clearTimeout(t);
  }, [draft]);

  function ruleBody(draft: Draft) {
    const approval = draft.approval || undefined;
    return {
      avatarId: draft.avatarId,
      name: draft.name,
      actionType: draft.actionType,
      trigger:
        draft.triggerType === "daily"
          ? { type: "daily", times: draft.times.split(/[,、\s]+/).filter(Boolean), timezone: "Asia/Tokyo" }
          : { type: "interval", hours: Number(draft.hours) },
      action:
        draft.actionType === "quote_post"
          ? {
              accountId: draft.quoteAccountId,
              mode: draft.mode,
              approval,
              scanPosts: Number(draft.scanPosts),
              maxDrafts: Number(draft.maxDrafts),
              maxAgeHours: Number(draft.maxAgeHours),
              sameAuthorCooldownDays: Number(draft.cooldownDays),
              excludeAuthors: draft.excludeAuthors.split(/[,、\s]+/).filter(Boolean),
              allowReuseAcrossAvatars: draft.allowReuse,
            }
          : { accountIds: draft.accountIds, topics: draft.topics.split("\n"), mode: draft.mode, approval, extraPrompt: draft.extraPrompt },
    };
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    const body = ruleBody(draft);
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

  /** 停止: このルールで自動承認された予約があれば、件数を示して「一緒に止めるか」を選んでもらう */
  async function stopRule(r: Rule) {
    let queued: { id: string; platform: string; text: string; scheduledAt: string | null }[] = [];
    try {
      queued = (await api<{ queued: typeof queued }>(`/api/automations/${r.id}`)).queued;
    } catch {
      /* 取得できなくても停止はできる */
    }
    let holdQueued = false;
    if (queued.length) {
      const list = queued.slice(0, 5).map((q) => `・${q.text}`).join("\n");
      holdQueued = confirm(
        `「${r.name}」で自動承認され、まだ送信されていない予約が ${queued.length} 件あります。\n${list}${queued.length > 5 ? "\n…" : ""}\n\nOK: 予約も止める（下書きに戻す）\nキャンセル: 予約は残してルールだけ止める`
      );
    }
    act(r.id, () => api(`/api/automations/${r.id}`, { method: "PATCH", json: { isActive: false, holdQueued } }), holdQueued ? `停止し、予約 ${queued.length} 件を下書きに戻しました` : "停止しました");
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
          <Link href="/settings?tab=ai-keys" className="underline">
            設定 → AI 共通 → API キー
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
          <Field
            def={{
              key: "type",
              label: "ルールの種類",
              type: "select",
              options: [
                { value: "generate_post", label: "AI で投稿文を生成" },
                { value: "quote_post", label: "X の引用投稿（タイムラインから探して、元投稿の URL を本文に入れて引用）" },
              ],
            }}
            value={draft.actionType}
            onChange={(v) => (draft.id ? undefined : setDraft({ ...draft, actionType: v as Draft["actionType"] }))}
          />
          {draft.id && <p className="-mt-3 text-[11px] text-white/35">種類は作成後に変更できません。</p>}
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
          {draft.mode === "auto" && (
            <div>
              <Field
                def={{
                  key: "approval",
                  label: "自動承認の範囲",
                  type: "select",
                  options: [...(draft.approval ? [] : [{ value: "", label: "選択してください" }]), ...(Object.keys(APPROVAL) as Approval[]).map((k) => ({ value: k, label: APPROVAL[k].label }))],
                }}
                value={draft.approval}
                onChange={(v) => setDraft({ ...draft, approval: v as Approval })}
              />
              {draft.actionType === "quote_post" && (
                <p className="mt-1 text-[11px] text-amber-300">X の自動化ルールには、自動の引用・返信に関する制限があります。引用の自動投稿は、規約に沿うことを確認したうえで使ってください（既定は下書き・承認制）。</p>
              )}
              {draft.approval === "all" && (
                <p className="mt-1 text-[11px] text-amber-300">全自動では、投稿前チェックが NG・失敗でも、Jev が保留と判定しても承認なしで投稿されます。</p>
              )}
              <p className="mt-1 text-[11px] text-white/40">
                投稿前チェック（AI）と Jev（gate モード時）の判定のうち、どこまでを承認なしで投稿するか。判定の障害（チェック失敗・Jev の失敗）は「条件付き」「厳格」では承認待ちになります。変更は次回の実行から反映され、すでに予約キューにある投稿も送信直前に新しい条件で再確認します。
              </p>
            </div>
          )}
          {draft.actionType === "quote_post" ? (
            <div className="space-y-3 rounded-lg border border-white/[0.06] p-3">
              <p className="text-[11px] text-white/45">
                ホームタイムラインから、アバターの人格・ナレッジ・対象読者に合う投稿を選んで、独自の意見や補足を添えた引用案を作ります。投稿時は元投稿の URL
                を本文に直接入れます（URL の前後に半角スペース。専用の引用 API は使いません）。同じ元投稿は再利用しません。実際に引用として表示されるかは X 側の表示に依存し、未検証です。
              </p>
              <Field
                def={{
                  key: "qacc",
                  label: "引用に使う X アカウント",
                  type: "select",
                  options: [{ value: "", label: "選択してください" }, ...avatarAccounts.filter((a) => a.platform === "x").map((a) => ({ value: a.id, label: a.accountName }))],
                }}
                value={draft.quoteAccountId}
                onChange={(v) => setDraft({ ...draft, quoteAccountId: v })}
              />
              <div className="grid gap-3 md:grid-cols-4">
                <Field def={{ key: "scan", label: "1回に読む件数（10〜100）", help: "自動実行では、アバター > X API のモードの件数・時刻が優先されます（費用の上限管理のため）" }} value={draft.scanPosts} onChange={(v) => setDraft({ ...draft, scanPosts: v })} />
                <Field def={{ key: "maxd", label: "1回に作る引用案の上限" }} value={draft.maxDrafts} onChange={(v) => setDraft({ ...draft, maxDrafts: v })} />
                <Field def={{ key: "age", label: "対象にする投稿（何時間以内）" }} value={draft.maxAgeHours} onChange={(v) => setDraft({ ...draft, maxAgeHours: v })} />
                <Field def={{ key: "cool", label: "同じ相手を引用しない日数" }} value={draft.cooldownDays} onChange={(v) => setDraft({ ...draft, cooldownDays: v })} />
              </div>
              <Field def={{ key: "ex", label: "引用しない相手（@なし・カンマ区切り）" }} value={draft.excludeAuthors} onChange={(v) => setDraft({ ...draft, excludeAuthors: v })} />
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={draft.allowReuse} onChange={(e) => setDraft({ ...draft, allowReuse: e.target.checked })} />
                別のアバターが引用済みの投稿も使う（既定は使わない）
              </label>
            </div>
          ) : (
          <>
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
          </>
          )}
          {estimate && (
            <p className="text-[11px] text-white/45">
              このルールの API 費用の目安（月 {estimate.runsPerMonth.toFixed(0)} 回）:{" "}
              {Object.entries(estimate.amounts).filter(([, v]) => v > 0).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(" + ") || "0"}
              {estimate.unpriced.length > 0 && <span className="text-amber-300">（単価未登録の分は未算定）</span>}
              {estimate.notes.length > 0 && <span className="text-amber-300"> {estimate.notes.join(" ／ ")}</span>}
              ・概算です。<Link href="/settings?tab=costs" className="underline">API コスト</Link>
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy === "save" || !draft.name.trim() || (draft.mode === "auto" && !draft.approval) || (draft.actionType === "quote_post" && !draft.quoteAccountId)}>
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
            setDraft({ ...NEW_DRAFT, avatarId: avatars[0]?.id ?? "" })
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
                    <Badge className={r.action.mode === "auto" ? ((r.action.approval ?? "all") === "all" ? "bg-amber-500/15 text-amber-300" : "bg-violet-500/15 text-violet-300") : "bg-cyan-500/15 text-cyan-300"}>
                      {r.action.mode === "auto" ? `自動投稿・${APPROVAL[r.action.approval ?? "all"].badge}` : "下書き→承認"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-white/50">{scheduleLabel(r.trigger)}</div>
                  {r.actionType === "quote_post" ? (
                    <div className="mt-1 text-xs text-white/50">
                      X 引用（URL を本文に挿入）: {accountName(r.action.accountId ?? "")}・1回 {r.action.scanPosts ?? 30} 件を読み、最大 {r.action.maxDrafts ?? 3} 件
                      {r.action.excludeAuthors?.length ? `・除外 ${r.action.excludeAuthors.length} 人` : ""}
                    </div>
                  ) : (
                    <>
                      <div className="mt-1 text-xs text-white/50">投稿先: {r.action.accountIds.map(accountName).join("、")}</div>
                      <div className="mt-1 text-xs text-white/40">トピック: {r.action.topics.join(" / ")}</div>
                    </>
                  )}
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
                    onClick={() => (r.isActive ? stopRule(r) : act(r.id, () => api(`/api/automations/${r.id}`, { method: "PATCH", json: { isActive: true } }), "再開しました"))}
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
