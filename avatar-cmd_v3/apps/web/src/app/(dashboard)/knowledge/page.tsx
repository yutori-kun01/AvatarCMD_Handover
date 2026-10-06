"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Embedded, EmptyState, relTime, Shell } from "@/components/dashboard/shell";
import { YoutubeSection } from "@/components/sections/youtube-section";
import { api, Badge, Button, Card, Field, inputCls, Notice } from "@/components/settings/ui";

interface Item {
  id: string;
  avatarId: string;
  kind: "fact" | "persona" | "learning";
  status: "active" | "disabled" | "proposed";
  title: string;
  summary: string | null;
  content: string | null;
  source: string;
  sourceUrl: string | null;
  sourceFetchedAt: string | null;
  tags: string[];
  scope: { platforms?: string[]; topics?: string[] };
  version: number;
  createdBy: string;
  evidence: { injectionWarning?: string[]; postIds?: string[]; cycleId?: string; videoUrl?: string; method?: string };
  updatedAt: string;
  score?: number;
}
interface Revision { id: string; version: number; snapshot: Partial<Item>; changedBy: string; reason: string | null; createdAt: string }
interface Change {
  id: string;
  type: "knowledge_add" | "rule_update";
  title?: string;
  summary?: string;
  ruleName?: string;
  before?: { topics: string[]; extraPrompt: string | null };
  after?: { topics: string[]; extraPrompt: string | null };
  reason: string;
  evidencePostIds?: string[];
}
interface Cycle {
  id: string;
  avatarId: string;
  triggerType: string;
  runStatus: string;
  status: string;
  mode: "suggest" | "approve" | "auto";
  attempt: number;
  scheduledFor: string | null;
  completedAt: string | null;
  nextIntervalDays: number | null;
  error: string | null;
  analysis: { note?: string | null; observations?: string[]; extraction?: { groups: { platform: string; format: string; posts: number; meanRate: number; above: unknown[] }[]; pending: { lowViews: number; tooYoung: number; noMetrics: number; smallGroups: unknown[] } } };
  suggestions: Change[];
  applied: Record<string, unknown> | null;
  createdAt: string;
}
interface Schedule { avatarId: string; enabled: boolean; mode: "suggest" | "approve" | "auto"; nextRunAt: string }

const KIND: Record<Item["kind"], { label: string; cls: string }> = {
  fact: { label: "出典付きの事実", cls: "bg-cyan-500/15 text-cyan-300" },
  persona: { label: "人格・文体", cls: "bg-violet-500/15 text-violet-300" },
  learning: { label: "成果からの学び", cls: "bg-emerald-500/15 text-emerald-300" },
};
const STATUS: Record<Item["status"], string> = { active: "有効", disabled: "無効", proposed: "提案（承認待ち）" };
const MODE: Record<Schedule["mode"], string> = { suggest: "提案のみ", approve: "承認後に適用", auto: "自動適用" };

const empty = { kind: "fact", title: "", summary: "", content: "", source: "", sourceUrl: "", tags: "", platforms: "", topics: "" };

function KnowledgeMain() {
  const [avatars, setAvatars] = useState<{ id: string; name: string }[]>([]);
  const [avatarId, setAvatarId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<(typeof empty & { id?: string }) | null>(null);
  const [history, setHistory] = useState<{ item: Item; revisions: Revision[] } | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  useEffect(() => {
    api<{ avatars: { id: string; name: string }[] }>("/api/integrations")
      .then((d) => {
        setAvatars(d.avatars);
        setAvatarId((cur) => cur || d.avatars[0]?.id || "");
      })
      .catch((e) => setNotice({ kind: "error", msg: e.message }));
  }, []);

  const load = useCallback(async () => {
    if (!avatarId) return;
    const q = new URLSearchParams({ avatarId, ...(kind ? { kind } : {}), ...(query.trim() ? { q: query.trim() } : {}) });
    const [k, imp] = await Promise.all([api<{ items: Item[] }>(`/api/knowledge?${q}`), api<{ schedules: Schedule[]; cycles: Cycle[] }>(`/api/improvement?avatarId=${avatarId}`)]);
    setItems(k.items);
    setSchedule(imp.schedules[0] ?? null);
    setCycles(imp.cycles);
  }, [avatarId, kind, query]);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", msg: e.message }));
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      setNotice({ kind: "ok", msg: ok });
      await load();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const split = (s: string) => s.split(/[,、\n]/).map((x) => x.trim()).filter(Boolean);

  async function save() {
    if (!form) return;
    const body = {
      avatarId,
      kind: form.kind,
      title: form.title,
      summary: form.summary,
      content: form.content,
      source: form.source,
      sourceUrl: form.sourceUrl,
      tags: split(form.tags),
      scope: { platforms: split(form.platforms), topics: split(form.topics) },
    };
    await run("save", () => (form.id ? api(`/api/knowledge/${form.id}`, { method: "PATCH", json: body }) : api("/api/knowledge", { method: "POST", json: body })), "ナレッジを保存しました");
    setForm(null);
  }

  const openHistory = async (it: Item) => setHistory(await api<{ item: Item; revisions: Revision[] }>(`/api/knowledge/${it.id}`));

  return (
    <Shell title="ナレッジ・改善" description="アバターごとの知識（出典付きの事実・人格・成果からの学び）と、14〜27日ごとの改善処理" wide>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      <div className="mb-4 flex flex-wrap gap-3">
        <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className={`${inputCls} w-56`}>
          {avatars.map((a) => (
            <option key={a.id} value={a.id} className="bg-[#111]">
              {a.name}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputCls} w-48`}>
          <option value="" className="bg-[#111]">すべての種別</option>
          {Object.entries(KIND).map(([k, v]) => (
            <option key={k} value={k} className="bg-[#111]">
              {v.label}
            </option>
          ))}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="投稿テーマで関連検索（生成で使われる順）" className={`${inputCls} w-80`} />
        <span className="flex-1" />
        <Button onClick={() => setForm({ ...empty })} disabled={!avatarId}>
          + ナレッジを追加
        </Button>
      </div>

      {form && (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold">{form.id ? "ナレッジを編集（変更前の版は履歴に残ります）" : "ナレッジを追加"}</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Field def={{ key: "kind", label: "種別", type: "select", options: Object.entries(KIND).map(([value, v]) => ({ value, label: v.label })) }} value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} />
            <Field def={{ key: "title", label: "タイトル", required: true }} value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
            <Field def={{ key: "tags", label: "タグ（カンマ区切り）" }} value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
          </div>
          <Field def={{ key: "summary", label: "要約（生成に使われます）", type: "textarea" }} value={form.summary} onChange={(v) => setForm({ ...form, summary: v })} />
          <Field def={{ key: "content", label: "本文（任意）", type: "textarea" }} value={form.content} onChange={(v) => setForm({ ...form, content: v })} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field def={{ key: "sourceUrl", label: "出典 URL", placeholder: "https://..." }} value={form.sourceUrl} onChange={(v) => setForm({ ...form, sourceUrl: v })} />
            <Field def={{ key: "source", label: "出典（書籍名など。URL が無い場合）" }} value={form.source} onChange={(v) => setForm({ ...form, source: v })} />
            <Field def={{ key: "platforms", label: "適用する SNS（空欄＝すべて。例: x, threads）" }} value={form.platforms} onChange={(v) => setForm({ ...form, platforms: v })} />
            <Field def={{ key: "topics", label: "関連するトピック（カンマ区切り。検索で優先）" }} value={form.topics} onChange={(v) => setForm({ ...form, topics: v })} />
          </div>
          {form.kind === "fact" && <p className="text-[11px] text-white/40">「出典付きの事実」には出典（URL または書籍名など）が必要です。</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy === "save" || !form.title.trim()}>
              保存
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      {history && (
        <Card className="mb-6 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">履歴: {history.item.title}（現在 v{history.item.version}）</h3>
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => setHistory(null)}>
              閉じる
            </Button>
          </div>
          {history.revisions.length === 0 ? (
            <EmptyState>変更履歴はありません</EmptyState>
          ) : (
            history.revisions.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-white/[0.06] p-2">
                <Badge className="bg-white/5 text-white/60">v{r.version}</Badge>
                <div className="min-w-0 flex-1">
                  <div>
                    {r.snapshot.title} — {STATUS[(r.snapshot.status as Item["status"]) ?? "active"]}
                  </div>
                  <div className="text-white/40">{(r.snapshot.summary ?? "").slice(0, 160)}</div>
                  <div className="text-[11px] text-white/30">
                    {new Date(r.createdAt).toLocaleString("ja-JP")}・{r.changedBy}
                    {r.reason ? `・${r.reason}` : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(`rev:${r.id}`, () => api(`/api/knowledge/${history.item.id}/revert`, { method: "POST", json: { version: r.version } }), `v${r.version} に差し戻しました`).then(() => openHistory(history.item))
                  }
                >
                  この版に戻す
                </Button>
              </div>
            ))
          )}
        </Card>
      )}

      <Card className="mb-6 p-0">
        {items.length === 0 ? (
          <div className="p-5">
            <EmptyState>ナレッジはまだありません</EmptyState>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {items.map((it) => (
              <div key={it.id} className={`flex flex-wrap items-start gap-3 px-5 py-3 ${it.status === "active" ? "" : "opacity-60"}`}>
                <Badge className={KIND[it.kind]?.cls ?? ""}>{KIND[it.kind]?.label ?? it.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    {it.title}
                    {it.status !== "active" && <span className="ml-2 text-xs text-amber-300">{STATUS[it.status]}</span>}
                    {typeof it.score === "number" && <span className="ml-2 text-[11px] text-white/35">関連度 {it.score.toFixed(2)}</span>}
                  </div>
                  {it.summary && <div className="text-xs text-white/55">{it.summary}</div>}
                  <div className="mt-1 text-[11px] text-white/35">
                    v{it.version}・{it.createdBy}・更新 {relTime(it.updatedAt)}
                    {it.sourceUrl && (
                      <>
                        ・出典{" "}
                        <a href={it.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                          {it.sourceUrl.slice(0, 60)}
                        </a>
                      </>
                    )}
                    {!it.sourceUrl && it.kind === "fact" && it.source ? `・出典 ${it.source}` : ""}
                    {it.sourceFetchedAt ? `（取得 ${new Date(it.sourceFetchedAt).toLocaleDateString("ja-JP")}）` : ""}
                    {it.scope?.platforms?.length ? `・SNS: ${it.scope.platforms.join(", ")}` : ""}
                  </div>
                  {it.evidence?.injectionWarning?.length ? <div className="text-[11px] text-amber-300">命令文らしき記述を含みます（資料として扱い、指示には従いません）</div> : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setForm({
                        id: it.id,
                        kind: it.kind,
                        title: it.title,
                        summary: it.summary ?? "",
                        content: it.content ?? "",
                        source: it.source === "url" || it.source === "manual" ? "" : it.source,
                        sourceUrl: it.sourceUrl ?? "",
                        tags: (it.tags ?? []).join(", "),
                        platforms: (it.scope?.platforms ?? []).join(", "),
                        topics: (it.scope?.topics ?? []).join(", "),
                      })
                    }
                  >
                    編集
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => run(`st:${it.id}`, () => api(`/api/knowledge/${it.id}`, { method: "PATCH", json: { status: it.status === "active" ? "disabled" : "active" } }), it.status === "active" ? "無効にしました" : "有効にしました")}
                  >
                    {it.status === "active" ? "無効化" : "有効化"}
                  </Button>
                  <Button variant="ghost" onClick={() => openHistory(it).catch((e) => setNotice({ kind: "error", msg: e.message }))}>
                    履歴
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold">改善処理（14〜27日ごと）</h3>
          <span className="text-xs text-white/45">{schedule ? `次回 ${new Date(schedule.nextRunAt).toLocaleString("ja-JP")}${schedule.enabled ? "" : "（停止中）"}` : "—"}</span>
          <span className="flex-1" />
          {schedule && (
            <>
              <select
                value={schedule.mode}
                onChange={(e) => run("mode", () => api("/api/improvement/schedule", { method: "PUT", json: { avatarId, mode: e.target.value } }), "適用モードを変更しました")}
                className={`${inputCls} w-40`}
              >
                {Object.entries(MODE).map(([k, v]) => (
                  <option key={k} value={k} className="bg-[#111]">
                    {v}
                  </option>
                ))}
              </select>
              <Button variant="ghost" onClick={() => run("en", () => api("/api/improvement/schedule", { method: "PUT", json: { avatarId, enabled: !schedule.enabled } }), schedule.enabled ? "停止しました" : "再開しました")}>
                {schedule.enabled ? "定期実行を止める" : "定期実行を再開"}
              </Button>
            </>
          )}
          <Button disabled={busy === "runimp"} onClick={() => run("runimp", () => api("/api/improvement/run", { method: "POST", json: { avatarId } }), "改善処理を実行しました")}>
            {busy === "runimp" ? "分析中…" : "今すぐ分析（日程は変えない）"}
          </Button>
        </div>
        <p className="text-[11px] text-white/40">
          数値の抽出（同じ SNS・投稿形式で、公開7日以降の指標・表示回数50以上・5件以上のグループだけ比較）はプログラムで行い、AI / Jev には好成績の理由と改善案の分析だけを任せます。変えられるのは「学びの追加」と「ルールのトピック・追加の指示」だけで、アバターの役割・目的・口調ルール・想定読者は変えません。
        </p>
        {cycles.length === 0 ? (
          <EmptyState>まだ実行されていません</EmptyState>
        ) : (
          cycles.map((c) => (
            <div key={c.id} className="rounded-lg border border-white/[0.06] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-white/5 text-white/60">{c.triggerType === "manual" ? "手動" : "定期"}</Badge>
                <Badge className={c.runStatus === "completed" ? "bg-emerald-500/15 text-emerald-300" : c.runStatus === "failed" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}>{c.runStatus}</Badge>
                <span className="text-white/50">{MODE[c.mode]}</span>
                <span className="text-white/35">
                  {new Date(c.completedAt ?? c.createdAt).toLocaleString("ja-JP")}
                  {c.nextIntervalDays ? `・次回まで ${c.nextIntervalDays} 日` : ""}
                  {c.attempt > 1 ? `・${c.attempt} 回目で完了` : ""}
                </span>
                <span className="flex-1" />
                {c.status === "pending" && c.suggestions.length > 0 && (
                  <Button variant="ghost" onClick={() => run(`dis:${c.id}`, () => api(`/api/improvement/${c.id}/dismiss`, { method: "POST" }), "見送りました")}>
                    見送る
                  </Button>
                )}
              </div>
              {c.error && <div className="mt-1 text-red-300">{c.error}</div>}
              {c.analysis?.note && <div className="mt-1 text-white/50">{c.analysis.note}</div>}
              {c.analysis?.extraction && (
                <div className="mt-1 text-white/40">
                  比較したグループ: {c.analysis.extraction.groups.map((g) => `${g.platform}・${g.format} ${g.posts}件（平均反応率 ${(g.meanRate * 100).toFixed(2)}%・平均超え ${g.above.length}件）`).join(" ／ ") || "なし"}
                  ・保留: 表示回数不足 {c.analysis.extraction.pending.lowViews}／経過日数不足 {c.analysis.extraction.pending.tooYoung}／指標なし {c.analysis.extraction.pending.noMetrics}
                </div>
              )}
              {c.analysis?.observations?.length ? <div className="mt-1 text-white/50">気づき（自動では変更しません）: {c.analysis.observations.join(" ／ ")}</div> : null}
              {c.suggestions.map((s) => {
                const done = !!c.applied?.[s.id];
                return (
                  <div key={s.id} className="mt-2 flex flex-wrap items-start gap-2 rounded border border-white/[0.05] p-2">
                    <div className="min-w-0 flex-1">
                      {s.type === "knowledge_add" ? (
                        <div>
                          学びを追加: <strong>{s.title}</strong> — {s.summary}
                          <span className="text-white/35">（根拠の投稿 {s.evidencePostIds?.length ?? 0} 件）</span>
                        </div>
                      ) : (
                        <div>
                          ルール「{s.ruleName}」: トピック {s.before?.topics.join(" / ")} → <strong>{s.after?.topics.join(" / ")}</strong>
                          {s.after?.extraPrompt !== s.before?.extraPrompt && (
                            <>
                              ・追加の指示 → <strong>{s.after?.extraPrompt}</strong>
                            </>
                          )}
                        </div>
                      )}
                      {s.reason && <div className="text-white/35">{s.reason}</div>}
                    </div>
                    {done ? (
                      <Badge className="bg-emerald-500/15 text-emerald-300">適用済み</Badge>
                    ) : c.mode === "suggest" ? (
                      <span className="text-white/30">提案のみ</span>
                    ) : (
                      c.status !== "dismissed" && (
                        <Button variant="ghost" disabled={busy === `ap:${c.id}:${s.id}`} onClick={() => run(`ap:${c.id}:${s.id}`, () => api(`/api/improvement/${c.id}/apply`, { method: "POST", json: { changeId: s.id } }), "適用しました")}>
                          適用
                        </Button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </Card>
    </Shell>
  );
}

const TABS = [
  { key: "knowledge", label: "ナレッジ・改善" },
  { key: "youtube", label: "YouTube 学習" },
] as const;

function KnowledgeTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "youtube" ? "youtube" : "knowledge";
  return (
    <Shell title="ナレッジ・学習" description="アバターの知識（出典付きの事実・人格・成果からの学び）、14〜27日ごとの改善処理、YouTube からの学習" wide>
      <div className="mb-5 flex gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => router.replace(t.key === "knowledge" ? "/knowledge" : `/knowledge?tab=${t.key}`)}
            className={`rounded-lg px-4 py-1.5 text-sm transition ${tab === t.key ? "bg-white/10 font-semibold text-white" : "text-white/50 hover:text-white"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "youtube" ? (
        <YoutubeSection />
      ) : (
        <Embedded>
          <KnowledgeMain />
        </Embedded>
      )}
    </Shell>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense>
      <KnowledgeTabs />
    </Suspense>
  );
}
