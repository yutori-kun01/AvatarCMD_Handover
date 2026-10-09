"use client";
// 動画エピソードの詳細: 工程の進み具合・人への報告・工程ごとの操作（承認 A〜D・差し戻し・アップロード）
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, ExternalLink, Pause, Play, X } from "lucide-react";
import { api, Badge, Button, Card, inputCls, Notice, uploadMedia } from "@/components/settings/ui";
import { TARGET_LABEL, type Episode, type MediaRef, type Shot } from "./types";

type Act = (action: string, body?: Record<string, unknown>, okMsg?: string) => Promise<boolean>;

interface AccountLite {
  id: string;
  avatarId: string;
  platform: string;
  accountName: string;
  isActive: boolean;
  settings: Record<string, unknown>;
}

const TARGET_PLATFORM: Record<string, string> = { youtube_long: "youtube", youtube_shorts: "youtube", tiktok: "tiktok", ig_reels: "instagram" };

function media(name: string | null | undefined) {
  return name ? `/media/${name}` : "";
}

function QcBadge({ shot }: { shot: Shot }) {
  const q = shot.qc;
  if (!q.result) return <Badge className="bg-white/10 text-white/50">未検品</Badge>;
  const cls = q.result === "pass" ? "bg-emerald-500/15 text-emerald-300" : q.result === "retry" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300";
  const label = q.result === "pass" ? "合格" : q.result === "retry" ? "作り直し" : "保留";
  return (
    <Badge className={cls}>
      {label}
      {q.engine ? `・${q.engine}` : ""}
      {q.confidence !== null ? ` ${Math.round(q.confidence * 100)}%` : ""}
      {q.retries ? `・再${q.retries}` : ""}
    </Badge>
  );
}

export function EpisodeDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [ep, setEp] = useState<Episode | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await api<{ episode: Episode }>(`/api/video/episodes/${id}`);
        if (!alive) return;
        setEp(d.episode);
        setError("");
        // ジョブが動いている間は数秒ごとに見に来る
        const working = d.episode.jobs.some((j) => j.status === "queued" || j.status === "running");
        timer = setTimeout(load, working ? 3000 : 15000);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    api<{ accounts: AccountLite[] }>("/api/integrations")
      .then((d) => setAccounts(d.accounts))
      .catch(() => setAccounts([]));
  }, []);

  const act: Act = async (action, body = {}, okMsg = "更新しました") => {
    setBusy(true);
    try {
      const d = await api<{ episode: Episode }>(`/api/video/episodes/${id}`, { method: "POST", json: { action, ...body } });
      setEp(d.episode);
      setNotice({ kind: "ok", msg: okMsg });
      onChanged();
      return true;
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!ep) return <p className="text-sm text-white/40">読み込み中…</p>;

  const stageIndex = ep.stages.findIndex((s) => s.id === ep.stage);
  const running = ep.jobs.filter((j) => j.status === "queued" || j.status === "running");
  const cost = Object.entries(ep.cost.amounts)
    .map(([c, v]) => `${v.toFixed(2)} ${c}`)
    .join(" / ");

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-white/40">
              {ep.episodeKey} ・ {ep.avatarName} ・ {ep.profileLabel}
              {ep.format ? ` ・ ${ep.format}` : ""}
            </div>
            <h2 className="break-words text-lg font-semibold">{ep.title || ep.theme || "（タイトル未定）"}</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              {ep.targets.map((t) => (
                <Badge key={t} className="bg-white/10 text-white/70">
                  {TARGET_LABEL[t] ?? t}
                </Badge>
              ))}
              {ep.status !== "active" && <Badge className="bg-amber-500/15 text-amber-300">{ep.status === "paused" ? "一時停止中" : ep.status === "done" ? "完了" : "中止"}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {ep.status === "active" && (
              <Button variant="ghost" disabled={busy} onClick={() => act("pause", {}, "一時停止しました")}>
                <Pause className="mr-1 inline h-3 w-3" />
                一時停止
              </Button>
            )}
            {ep.status === "paused" && (
              <Button disabled={busy} onClick={() => act("resume", {}, "再開しました")}>
                <Play className="mr-1 inline h-3 w-3" />
                再開
              </Button>
            )}
            {(ep.status === "active" || ep.status === "paused") && (
              <Button variant="danger" disabled={busy} onClick={() => confirm("このエピソードを中止しますか？（元に戻せません）") && act("cancel", {}, "中止しました")}>
                中止
              </Button>
            )}
          </div>
        </div>
        <ol className="flex flex-wrap gap-1">
          {ep.stages.map((s, i) => (
            <li
              key={s.id}
              className={`rounded-md px-2 py-1 text-[11px] ${
                i < stageIndex ? "bg-emerald-500/10 text-emerald-300/80" : i === stageIndex ? (s.gate ? "bg-amber-500/20 font-semibold text-amber-200" : "bg-cyan-500/20 font-semibold text-cyan-200") : "bg-white/[0.04] text-white/35"
              }`}
              title={s.label}
            >
              {i < stageIndex && <Check className="mr-0.5 inline h-3 w-3" />}
              {s.label}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
          <span>
            費用: {cost || "0"}（上限 {ep.cost.limit} {ep.cost.currency}・API 呼び出し {ep.cost.calls} 回{ep.cost.unpricedRows ? `・未算定 ${ep.cost.unpricedRows} 件` : ""}）
          </span>
          {running.length > 0 && <span className="text-cyan-300">処理中 {running.length} 件{running[0].progress ? `（${running[0].progress}）` : ""}</span>}
          {!ep.assetsApproved && (
            <Link href="/settings?tab=video-assets" className="text-amber-300 underline">
              固定アセットが未確定です
            </Link>
          )}
        </div>
      </Card>

      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}

      {ep.report && (
        <Card className="space-y-2 border-amber-500/30 bg-amber-500/[0.06]">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-amber-200">報告: {ep.report.what}</h3>
            <button onClick={() => act("dismissReport", {}, "確認済みにしました")} className="text-white/40 hover:text-white" title="確認済みにする">
              <X className="h-4 w-4" />
            </button>
          </div>
          <dl className="grid gap-1 text-xs text-white/70 md:grid-cols-[7rem_1fr]">
            <dt className="text-white/40">どこで</dt>
            <dd className="break-words">{ep.report.where}</dd>
            <dt className="text-white/40">試したこと</dt>
            <dd className="break-words">{ep.report.tried}</dd>
            <dt className="text-white/40">決めてほしいこと</dt>
            <dd>
              <ul className="list-inside list-disc">
                {ep.report.choices.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </dd>
          </dl>
        </Card>
      )}

      {ep.stage === "topics" && <Waiting ep={ep} act={act} busy={busy} text="ネタ候補を作っています（一次情報の URL を確認しています）" />}
      {ep.stage === "approve_topic" && <TopicPanel ep={ep} act={act} busy={busy} />}
      {ep.stage === "script" && <Waiting ep={ep} act={act} busy={busy} text="台本とカット指示書を書いています（章立て → 本文 → 自己批評 → 修正）" />}
      {ep.stage === "approve_script" && <ScriptPanel ep={ep} act={act} busy={busy} />}
      {ep.stage === "narration" && <Waiting ep={ep} act={act} busy={busy} text="ナレーションを作り、カットの尺を確定しています" />}
      {["storyboard", "final", "render"].includes(ep.stage) && ep.status === "active" && running.length === 0 && ep.jobs.some((j) => j.status === "failed") && (
        <Card className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-red-300">失敗したジョブがあります。設定を直してから、止まっているカットを再実行できます。</p>
          <Button disabled={busy} onClick={() => act("retry", {}, "止まっているカットを再実行しています")}>
            再実行
          </Button>
        </Card>
      )}
      {(ep.stage === "storyboard" || ep.stage === "approve_storyboard") && <StoryboardPanel ep={ep} act={act} busy={busy} />}
      {ep.stage === "final" && <ImagesPanel ep={ep} act={act} busy={busy} />}
      {ep.stage === "video" && <VideoPanel ep={ep} act={act} busy={busy} />}
      {(ep.stage === "render" || ep.stage === "approve_publish") && <RenderPanel ep={ep} act={act} busy={busy} />}
      {ep.stage === "approve_publish" && <PublishPanel ep={ep} act={act} busy={busy} accounts={accounts.filter((a) => a.avatarId === ep.avatarId && a.isActive)} />}
      {ep.stage === "scheduled" && <ScheduledPanel ep={ep} />}

      <NarrationInfo ep={ep} act={act} busy={busy} />
      <JobsInfo ep={ep} />
    </div>
  );
}

function Waiting({ ep, act, busy, text }: { ep: Episode; act: Act; busy: boolean; text: string }) {
  const working = ep.jobs.some((j) => j.status === "queued" || j.status === "running");
  if (!working && ep.status === "active") {
    const failed = ep.jobs.find((j) => j.status === "failed");
    return (
      <Card className="space-y-2">
        <p className="text-sm text-red-300">この工程は止まっています{failed?.error ? `: ${failed.error.slice(0, 200)}` : ""}</p>
        <p className="text-[11px] text-white/40">設定（API キーなど）を直してから再実行してください。</p>
        <Button disabled={busy} onClick={() => act("retry", {}, "再実行しています")}>
          再実行
        </Button>
      </Card>
    );
  }
  return (
    <Card>
      <p className={`text-sm text-cyan-200 ${working ? "animate-pulse" : ""}`}>
        {text}
        {working ? "…" : "（一時停止中）"}
      </p>
      <p className="mt-1 text-[11px] text-white/40">画面を閉じても処理は続きます。</p>
    </Card>
  );
}

// --- 承認 A: ネタ選定 -------------------------------------------------------------

function TopicPanel({ ep, act, busy }: { ep: Episode; act: Act; busy: boolean }) {
  const [pick, setPick] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">承認A: ネタを 1 件選んでください</h3>
      <p className="text-xs text-white/50">一次情報の URL を開いて確認してから選んでください。「確認できず」の URL は自動で開けなかったものです。</p>
      <div className="space-y-2">
        {ep.topics.map((t, i) => (
          <label key={i} className={`block cursor-pointer rounded-lg border p-3 ${pick === i ? "border-cyan-400/60 bg-cyan-500/[0.06]" : "border-white/[0.08] hover:bg-white/[0.03]"}`}>
            <div className="flex items-start gap-2">
              <input type="radio" name="topic" checked={pick === i} onChange={() => setPick(i)} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t.title}</div>
                <div className="text-xs text-white/60">{t.angle}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {t.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[11px] text-cyan-300 hover:underline">
                      {s.label || s.url}
                      <ExternalLink className="h-3 w-3" />
                      {s.ok === false && <span className="text-amber-300">（確認できず）</span>}
                    </a>
                  ))}
                  {!t.sources.length && <span className="text-[11px] text-red-300">一次情報の URL がありません</span>}
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || pick === null} onClick={() => pick !== null && act("approveTopic", { index: pick }, "承認A: ネタを選びました。台本を書いています")}>
          このネタで台本を作る（承認A）
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="作り直しの指示（例: 海外の事例を中心に）" className={`${inputCls} max-w-md`} />
        <Button variant="ghost" disabled={busy} onClick={() => act("regenerateTopics", { feedback }, "ネタ候補を作り直しています")}>
          候補を作り直す
        </Button>
      </div>
    </Card>
  );
}

// --- 承認 B: 台本確認 -------------------------------------------------------------

function ScriptPanel({ ep, act, busy }: { ep: Episode; act: Act; busy: boolean }) {
  const [script, setScript] = useState(ep.script ?? "");
  const [title, setTitle] = useState(ep.title);
  const [feedback, setFeedback] = useState("");
  const [checks, setChecks] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const dirty = script !== (ep.script ?? "") || title !== ep.title;

  useEffect(() => {
    api<{ checks: { errors: string[]; warnings: string[] } }>(`/api/video/episodes/${ep.id}?include=checks`)
      .then((d) => setChecks(d.checks))
      .catch(() => setChecks(null));
  }, [ep.id, ep.script, ep.title]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">承認B: 台本を確認してください</h3>
        <p className="text-xs text-white/50">
          事実と出典を確認し{ep.insightMarker ? `、台本の ${ep.insightMarker} を語り手の考察 2〜3 行に置き換えて` : ""}から承認してください。カット指示書（下の一覧）のセリフは台本と対応しています。
        </p>
        <label className="block">
          <span className="mb-1 block text-xs text-white/60">タイトル</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} list="title-candidates" />
          <datalist id="title-candidates">
            {ep.shotlist.title_candidates.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={16} className={`${inputCls} font-mono text-[13px] leading-relaxed`} />
        {ep.insightMarker && script.includes(ep.insightMarker) && <p className="text-xs text-amber-300">考察パートが未記入です（{ep.insightMarker}）</p>}
        {ep.shotlist.sources.length > 0 && (
          <div className="text-xs text-white/60">
            出典:{" "}
            {ep.shotlist.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="mr-3 text-cyan-300 hover:underline">
                {s.label || s.url}
              </a>
            ))}
          </div>
        )}
        {checks && (checks.errors.length > 0 || checks.warnings.length > 0) && (
          <ul className="space-y-1 text-xs">
            {checks.errors.map((e) => (
              <li key={e} className="whitespace-pre-wrap text-red-300">
                ✗ {e}
              </li>
            ))}
            {checks.warnings.map((w) => (
              <li key={w} className="text-amber-300">
                ! {w}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={busy || !dirty} onClick={() => act("updateScript", { script, title }, "台本を保存しました")}>
            保存
          </Button>
          <Button disabled={busy || dirty || !!checks?.errors.length} onClick={() => act("approveScript", {}, "承認B: ナレーションと絵コンテを作っています")} title={dirty ? "先に保存してください" : undefined}>
            承認してナレーション・絵コンテへ（承認B）
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="AI への修正の指示（例: 冒頭をもっと短く）" className={`${inputCls} max-w-md`} />
          <Button variant="ghost" disabled={busy || !feedback.trim()} onClick={() => act("requestScriptRevision", { feedback }, "修正版を書いています")}>
            AI に書き直しを依頼
          </Button>
        </div>
      </Card>
      <ShotTable ep={ep} act={act} busy={busy} editable />
    </div>
  );
}

function ShotTable({ ep, act, busy, editable }: { ep: Episode; act: Act; busy: boolean; editable?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <Card className="space-y-2">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-sm font-semibold">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        カット指示書（{ep.shotlist.shots.length} カット・約 {Math.round(ep.shotlist.shots.reduce((a, s) => a + s.duration_sec, 0))} 秒）
      </button>
      {open && (
        <div className="space-y-3">
          {ep.issues.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-300">
              ! {w}
            </p>
          ))}
          {ep.shotlist.chapters.map((c) => (
            <div key={c.chapter_id} className="space-y-1">
              <div className="text-xs font-semibold text-white/60">
                {c.chapter_id} {c.title}
              </div>
              {ep.shotlist.shots
                .filter((s) => s.chapter_id === c.chapter_id)
                .map((s) => (
                  <ShotRow key={s.shot_id} shot={s} act={act} busy={busy} editable={editable} />
                ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ShotRow({ shot, act, busy, editable }: { shot: Shot; act: Act; busy: boolean; editable?: boolean }) {
  const [edit, setEdit] = useState(false);
  const [narration, setNarration] = useState(shot.narration);
  const [description, setDescription] = useState(shot.visual.description);
  const [composition, setComposition] = useState(shot.visual.composition);
  const [motion, setMotion] = useState(shot.motion_type);
  return (
    <div className="grid gap-2 rounded-lg border border-white/[0.06] p-2 text-xs md:grid-cols-[4rem_1fr_1fr_6rem]">
      <div className="text-white/50">
        <div className="font-mono">{shot.shot_id}</div>
        <div>{shot.duration_sec}s</div>
        {shot.short_candidate.is_candidate && <Badge className="mt-1 bg-pink-500/15 text-pink-300">ショート{shot.short_candidate.hook_rank ? `#${shot.short_candidate.hook_rank}` : ""}</Badge>}
      </div>
      {edit ? (
        <>
          <textarea value={narration} onChange={(e) => setNarration(e.target.value)} rows={3} className={inputCls} />
          <div className="space-y-1">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} placeholder="何を描くか" />
            <input value={composition} onChange={(e) => setComposition(e.target.value)} className={inputCls} placeholder="構図" />
          </div>
          <div className="space-y-1">
            <select value={motion} onChange={(e) => setMotion(e.target.value as Shot["motion_type"])} className={inputCls}>
              <option value="pseudo" className="bg-[#111]">pseudo</option>
              <option value="i2v" className="bg-[#111]">i2v</option>
              <option value="static" className="bg-[#111]">static</option>
            </select>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await act("updateShot", { shotId: shot.shot_id, patch: { narration, motion_type: motion, visual: { ...shot.visual, description, composition } } }, `${shot.shot_id} を保存しました`)) setEdit(false);
              }}
            >
              保存
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="whitespace-pre-wrap text-white/80">{shot.narration}</div>
          <div className="text-white/60">
            <div>{shot.visual.description}</div>
            <div className="text-white/40">{shot.visual.composition}</div>
            {shot.visual.character && <div className="text-white/40">キャラ: {shot.visual.expression}</div>}
            {shot.visual.realistic && <div className="text-amber-300">実写風（開示が必要）</div>}
          </div>
          <div className="text-white/50">
            <div>{shot.motion_type}</div>
            {shot.motion_note && <div className="text-white/35">{shot.motion_note}</div>}
            {editable && (
              <button onClick={() => setEdit(true)} className="mt-1 text-cyan-300 hover:underline">
                直す
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --- 絵コンテ（承認 C） ------------------------------------------------------------

function StoryboardPanel({ ep, act, busy }: { ep: Episode; act: Act; busy: boolean }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const gate = ep.stage === "approve_storyboard";
  const pending = ep.shotlist.shots.filter((s) => s.storyboard_review !== "approved");
  const ready = pending.filter((s) => s.assets.storyboard && !ep.jobs.some((j) => j.shotId === s.shot_id && (j.status === "queued" || j.status === "running")));
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{gate ? "承認C: 絵コンテをカットごとに承認・差し戻ししてください" : "絵コンテを生成・検品しています"}</h3>
        {gate && ready.length > 0 && (
          <Button disabled={busy} onClick={() => act("reviewStoryboard", { decisions: ready.map((s) => ({ shotId: s.shot_id, approve: true })) }, `${ready.length} カットを承認しました`)}>
            表示中の未承認 {ready.length} カットをすべて承認
          </Button>
        )}
      </div>
      <p className="text-xs text-white/50">差し戻しは理由を書いてください（理由はカット指示書に記録され、作り直しのプロンプトに入ります）。承認済みのカットは作り直しません。</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ep.shotlist.shots.map((s) => {
          const working = ep.jobs.some((j) => j.shotId === s.shot_id && j.step === "storyboard" && (j.status === "queued" || j.status === "running"));
          return (
            <div key={s.shot_id} className={`space-y-2 rounded-xl border p-2 ${s.storyboard_review === "approved" ? "border-emerald-500/30" : s.storyboard_review === "rejected" ? "border-red-500/30" : "border-white/[0.08]"}`}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-white/60">{s.shot_id}</span>
                <QcBadge shot={s} />
              </div>
              {s.assets.storyboard ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media(s.assets.storyboard)} alt={s.visual.description} className={`aspect-square w-full rounded-lg object-cover ${working ? "opacity-40" : ""}`} />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-white/[0.03] text-xs text-white/30">{working ? "生成中…" : "未生成"}</div>
              )}
              <div className="line-clamp-3 text-[11px] text-white/70">{s.narration}</div>
              {s.qc.note && <div className="text-[11px] text-amber-300">検品: {s.qc.note}</div>}
              {s.review_note && <div className="text-[11px] text-white/50">メモ: {s.review_note}</div>}
              {gate && s.storyboard_review !== "approved" && s.assets.storyboard && !working && (
                <div className="space-y-1">
                  <input value={notes[s.shot_id] ?? ""} onChange={(e) => setNotes({ ...notes, [s.shot_id]: e.target.value })} placeholder="差し戻しの理由" className={`${inputCls} py-1 text-xs`} />
                  <div className="flex gap-1">
                    <Button disabled={busy} onClick={() => act("reviewStoryboard", { decisions: [{ shotId: s.shot_id, approve: true }] }, `${s.shot_id} を承認しました`)}>
                      承認
                    </Button>
                    <Button variant="danger" disabled={busy || !notes[s.shot_id]?.trim()} onClick={() => act("reviewStoryboard", { decisions: [{ shotId: s.shot_id, approve: false, note: notes[s.shot_id] }] }, `${s.shot_id} を差し戻しました`)}>
                      差し戻し
                    </Button>
                  </div>
                </div>
              )}
              {s.storyboard_review === "approved" && <div className="text-[11px] text-emerald-300">承認済み</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// --- 本番画像 ---------------------------------------------------------------------

function ImagesPanel({ ep, act, busy }: { ep: Episode; act: Act; busy: boolean }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">本番画像を生成・検品しています</h3>
      <p className="text-xs text-white/50">承認された絵コンテを参照に 2048×2048 で作り直します。自動の作り直しが止まったカットは、今の画像で合格にするか、指示を添えて作り直してください。</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ep.shotlist.shots.map((s) => {
          const working = ep.jobs.some((j) => j.shotId === s.shot_id && j.step === "final" && (j.status === "queued" || j.status === "running"));
          const stuck = !working && s.status !== "final_ok" && s.status !== "video_ok" && s.assets.final_image;
          return (
            <div key={s.shot_id} className="space-y-2 rounded-xl border border-white/[0.08] p-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-white/60">{s.shot_id}</span>
                <QcBadge shot={s} />
              </div>
              {s.assets.final_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media(s.assets.final_image)} alt="" className={`aspect-square w-full rounded-lg object-cover ${working ? "opacity-40" : ""}`} />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-white/[0.03] text-xs text-white/30">{working ? "生成中…" : "待機中"}</div>
              )}
              {s.qc.note && <div className="text-[11px] text-amber-300">検品: {s.qc.note}</div>}
              {stuck && (
                <div className="space-y-1">
                  <input value={notes[s.shot_id] ?? ""} onChange={(e) => setNotes({ ...notes, [s.shot_id]: e.target.value })} placeholder="作り直しの指示（任意）" className={`${inputCls} py-1 text-xs`} />
                  <div className="flex gap-1">
                    <Button disabled={busy} onClick={() => act("resolveShot", { shotId: s.shot_id, resolve: "accept", note: notes[s.shot_id] }, `${s.shot_id} を合格にしました`)}>
                      この画像で合格
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => act("resolveShot", { shotId: s.shot_id, resolve: "regenerate", note: notes[s.shot_id] }, `${s.shot_id} を作り直しています`)}>
                      作り直す
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// --- 動画化（i2v） ------------------------------------------------------------------

function UploadButton({ accept, label, busy, onFile }: { accept: string; label: string; busy: boolean; onFile: (m: MediaRef) => Promise<unknown> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setUp(true);
          try {
            await onFile(await uploadMedia(f));
          } catch (err) {
            alert((err as Error).message);
          } finally {
            setUp(false);
            if (ref.current) ref.current.value = "";
          }
        }}
      />
      <Button variant="ghost" disabled={busy || up} onClick={() => ref.current?.click()}>
        {up ? "アップロード中…" : label}
      </Button>
    </>
  );
}

function VideoPanel({ ep, act, busy }: { ep: Episode; act: Act; busy: boolean }) {
  const shots = ep.shotlist.shots.filter((s) => s.motion_type === "i2v");
  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">動画化（i2v）</h3>
      <p className="text-xs text-white/50">
        本番画像を開始フレームに、キャラのエレメントを紐づけて Kling で 5 秒程度の動画を作り（音声生成はオフ）、ここにアップロードしてください。費用を抑える場合は pseudo（ズーム・パン）に切り替えられます。
        {ep.pseudoFallback.length > 0 && ` i2v の上限を超えているカット: ${ep.pseudoFallback.join(", ")}`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shots.map((s) => (
          <div key={s.shot_id} className="space-y-2 rounded-xl border border-white/[0.08] p-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-white/60">{s.shot_id}</span>
              {s.status === "video_ok" ? <Badge className="bg-emerald-500/15 text-emerald-300">登録済み</Badge> : <Badge className="bg-white/10 text-white/50">未登録</Badge>}
            </div>
            {s.assets.video ? (
              <video src={media(s.assets.video)} controls className="aspect-square w-full rounded-lg bg-black object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media(s.assets.final_image)} alt="" className="aspect-square w-full rounded-lg object-cover" />
            )}
            <div className="text-[11px] text-white/60">動き: {s.motion_note || "（指定なし）"}</div>
            {s.status !== "video_ok" && (
              <div className="flex flex-wrap gap-1">
                <a href={media(s.assets.final_image)} download className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 no-underline hover:bg-white/[0.06]">
                  開始フレームを保存
                </a>
                <UploadButton accept="video/mp4,video/quicktime,video/webm" label="動画をアップロード" busy={busy} onFile={(m) => act("setShotVideo", { shotId: s.shot_id, media: m }, `${s.shot_id} の動画を登録しました`)} />
                <Button variant="ghost" disabled={busy} onClick={() => act("setShotVideo", { shotId: s.shot_id, switchToPseudo: true }, `${s.shot_id} を pseudo に切り替えました`)}>
                  pseudo に切り替え
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- 書き出し・サムネイル --------------------------------------------------------------

function RenderPanel({ ep, act, busy }: { ep: Episode; act: Act; busy: boolean }) {
  const [feedback, setFeedback] = useState("");
  const thumbsWorking = ep.jobs.some((j) => j.step === "thumbnails" && (j.status === "queued" || j.status === "running"));
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">書き出し</h3>
        <p className="text-xs text-white/50">
          書き出し（Remotion + FFmpeg）に必要な情報は manifest にまとめてあります（カットの開始・終了、画像・動画、擬似アニメの動き、字幕、ブランド、ナレーション音声）。書き出した動画を出力先ごとにアップロードしてください。
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/video/episodes/${ep.id}?include=manifest`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 no-underline hover:bg-white/[0.06]">
            manifest（JSON）
          </a>
          {ep.narration.srt && (
            <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(ep.narration.srt)}`} download={`${ep.episodeKey}.srt`} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 no-underline hover:bg-white/[0.06]">
              字幕（SRT）
            </a>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {ep.targets.map((t) => (
            <div key={t} className="space-y-2 rounded-lg border border-white/[0.08] p-3">
              <div className="flex items-center justify-between text-sm">
                <span>{TARGET_LABEL[t] ?? t}</span>
                {ep.renders[t] ? <Badge className="bg-emerald-500/15 text-emerald-300">登録済み</Badge> : <Badge className="bg-white/10 text-white/50">未登録</Badge>}
              </div>
              {ep.renders[t] && <video src={media(ep.renders[t].name)} controls className="max-h-64 w-full rounded-lg bg-black" />}
              <UploadButton accept="video/mp4,video/quicktime,video/webm" label={ep.renders[t] ? "差し替える" : "動画をアップロード"} busy={busy} onFile={(m) => act("setRender", { target: t, media: m }, `${TARGET_LABEL[t] ?? t} の動画を登録しました`)} />
            </div>
          ))}
        </div>
      </Card>
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">サムネイル候補</h3>
        <p className="text-xs text-white/50">キャラ設定書を参照に 3 案を作ります（文字は入れていません）。文字を合成したものはアップロードして候補に加えてください。</p>
        {thumbsWorking && <p className="animate-pulse text-xs text-cyan-200">サムネイルを作っています…</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          {ep.thumbnails.map((t) => (
            <div key={t.name} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={media(t.name)} alt="" className="aspect-video w-full rounded-lg object-cover" />
              <button onClick={() => act("setThumbnails", { remove: t.name }, "候補から外しました")} className="absolute right-1 top-1 rounded bg-black/70 px-1.5 text-xs text-white/70 hover:text-white">
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <UploadButton accept="image/png,image/jpeg,image/webp" label="画像を追加" busy={busy} onFile={(m) => act("setThumbnails", { add: m }, "候補に加えました")} />
          <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="作り直しの指示（任意）" className={`${inputCls} max-w-xs`} />
          <Button variant="ghost" disabled={busy || thumbsWorking} onClick={() => act("setThumbnails", { regenerate: feedback }, "サムネイルを作り直しています")}>
            3 案を作り直す
          </Button>
        </div>
      </Card>
    </div>
  );
}

// --- 承認 D: 公開前の最終確認 ---------------------------------------------------------------

function localInput(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function PublishPanel({ ep, act, busy, accounts }: { ep: Episode; act: Act; busy: boolean; accounts: AccountLite[] }) {
  const tomorrow = new Date(Date.now() + 86400_000);
  tomorrow.setHours(19, 0, 0, 0);
  const [title, setTitle] = useState(ep.title);
  const [description, setDescription] = useState("");
  const [thumbnail, setThumbnail] = useState(ep.thumbnails[0]?.name ?? "");
  const [tags, setTags] = useState("");
  const [madeForKids, setMadeForKids] = useState<"" | "false" | "true">("");
  const [disclosure, setDisclosure] = useState(false);
  const [plans, setPlans] = useState<Record<string, { accountId: string; publishAt: string; text: string; shareToFeed: boolean; tiktok: { privacyLevel: string; disableComment: boolean; disableDuet: boolean; disableStitch: boolean; consent: boolean } }>>(() =>
    Object.fromEntries(
      ep.targets.map((t) => [
        t,
        {
          accountId: accounts.find((a) => a.platform === TARGET_PLATFORM[t])?.id ?? "",
          publishAt: localInput(tomorrow),
          text: "",
          shareToFeed: true,
          tiktok: { privacyLevel: "", disableComment: false, disableDuet: false, disableStitch: false, consent: false },
        },
      ])
    )
  );

  useEffect(() => {
    api<{ description: string }>(`/api/video/episodes/${ep.id}?include=description`)
      .then((d) => setDescription((cur) => cur || d.description))
      .catch(() => undefined);
  }, [ep.id]);

  useEffect(() => {
    // アカウント一覧が後から届いた場合に既定を入れる
    setPlans((cur) => Object.fromEntries(Object.entries(cur).map(([t, p]) => [t, p.accountId ? p : { ...p, accountId: accounts.find((a) => a.platform === TARGET_PLATFORM[t])?.id ?? "" }])));
  }, [accounts]);

  const set = (t: string, patch: Partial<(typeof plans)[string]>) => setPlans({ ...plans, [t]: { ...plans[t], ...patch } });

  async function approve() {
    const targets = Object.fromEntries(
      ep.targets.map((t) => {
        const p = plans[t];
        return [
          t,
          {
            accountId: p.accountId,
            publishAt: new Date(p.publishAt).toISOString(),
            text: p.text,
            shareToFeed: p.shareToFeed,
            ...(t === "tiktok" ? { tiktok: p.tiktok } : {}),
          },
        ];
      })
    );
    await act(
      "approvePublish",
      { plan: { title, description, thumbnail, tags: tags.split(/[\s,、]+/).filter(Boolean), madeForKids: madeForKids === "true", disclosureConfirmed: disclosure, targets } },
      "承認D: 予約投稿しました"
    );
  }

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-semibold">承認D: 公開前の最終確認</h3>
      <p className="text-xs text-white/50">
        YouTube は今すぐ非公開でアップロードし、指定日時に自動で公開されます。TikTok / Instagram は API に予約が無いため、指定日時に Avatar CMD から送ります。公開状態でのアップロードはしません。
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-white/60">タイトル（YouTube は 100 文字まで）</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} list="title-candidates-d" />
          <datalist id="title-candidates-d">
            {ep.shotlist.title_candidates.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-white/60">タグ（空白区切り。ショートの本文にはハッシュタグとして 3 つまで）</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-white/60">概要欄（導入文・チャプター・出典・BGM の帰属表記・ハッシュタグ 3 つまで）</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} className={inputCls} />
      </label>
      <div>
        <div className="mb-1 text-xs text-white/60">サムネイル（3 案を YouTube Studio の「テストと比較」で A/B テストする場合は Studio で設定）</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {ep.thumbnails.map((t) => (
            <button key={t.name} onClick={() => setThumbnail(t.name)} className={`overflow-hidden rounded-lg border-2 ${thumbnail === t.name ? "border-cyan-400" : "border-transparent"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={media(t.name)} alt="" className="aspect-video w-full object-cover" />
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {ep.targets.map((t) => {
          const p = plans[t];
          const options = accounts.filter((a) => a.platform === TARGET_PLATFORM[t]);
          const acc = options.find((a) => a.id === p.accountId);
          const draftMode = t === "tiktok" && acc?.settings?.postMode === "draft";
          return (
            <div key={t} className="space-y-2 rounded-lg border border-white/[0.08] p-3">
              <div className="text-sm font-semibold">{TARGET_LABEL[t] ?? t}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-white/60">投稿先アカウント</span>
                  <select value={p.accountId} onChange={(e) => set(t, { accountId: e.target.value })} className={inputCls}>
                    <option value="" className="bg-[#111]">
                      — 選択 —
                    </option>
                    {options.map((a) => (
                      <option key={a.id} value={a.id} className="bg-[#111]">
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                  {!options.length && (
                    <Link href="/settings?tab=accounts" className="text-[11px] text-amber-300 underline">
                      このアバターの {TARGET_PLATFORM[t]} アカウントを接続してください
                    </Link>
                  )}
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-white/60">公開日時</span>
                  <input type="datetime-local" value={p.publishAt} onChange={(e) => set(t, { publishAt: e.target.value })} className={inputCls} />
                </label>
              </div>
              {(t === "tiktok" || t === "ig_reels") && (
                <label className="block">
                  <span className="mb-1 block text-xs text-white/60">キャプション（空欄ならタイトル）</span>
                  <textarea value={p.text} onChange={(e) => set(t, { text: e.target.value })} rows={2} className={inputCls} />
                </label>
              )}
              {t === "ig_reels" && (
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input type="checkbox" checked={p.shareToFeed} onChange={(e) => set(t, { shareToFeed: e.target.checked })} />
                  リールをフィードにも表示する
                </label>
              )}
              {t === "tiktok" &&
                (draftMode ? (
                  <p className="text-[11px] text-white/50">このアカウントは「下書き」モードです。TikTok アプリの受信トレイに届くので、公開範囲などはアプリで選んで公開してください。</p>
                ) : (
                  <div className="space-y-2 rounded-lg bg-white/[0.03] p-2">
                    <div className="grid gap-2 md:grid-cols-4">
                      <select value={p.tiktok.privacyLevel} onChange={(e) => set(t, { tiktok: { ...p.tiktok, privacyLevel: e.target.value } })} className={inputCls}>
                        <option value="" className="bg-[#111]">公開範囲を選択</option>
                        <option value="SELF_ONLY" className="bg-[#111]">自分のみ</option>
                        <option value="MUTUAL_FOLLOW_FRIENDS" className="bg-[#111]">相互フォロー</option>
                        <option value="FOLLOWER_OF_CREATOR" className="bg-[#111]">フォロワー</option>
                        <option value="PUBLIC_TO_EVERYONE" className="bg-[#111]">全員に公開</option>
                      </select>
                      {(["disableComment", "disableDuet", "disableStitch"] as const).map((k) => (
                        <label key={k} className="flex items-center gap-2 text-xs text-white/70">
                          <input type="checkbox" checked={!p.tiktok[k]} onChange={(e) => set(t, { tiktok: { ...p.tiktok, [k]: !e.target.checked } })} />
                          {k === "disableComment" ? "コメントを許可" : k === "disableDuet" ? "デュエットを許可" : "リミックスを許可"}
                        </label>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-white/80">
                      <input type="checkbox" checked={p.tiktok.consent} onChange={(e) => set(t, { tiktok: { ...p.tiktok, consent: e.target.checked } })} />
                      上の設定と AI 生成ラベル付きで投稿することに同意します（TikTok のガイドライン上の必須確認）
                    </label>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      <div className="space-y-2 rounded-lg bg-white/[0.03] p-3">
        <label className="flex items-center gap-2 text-xs text-white/80">
          子ども向け:
          <select value={madeForKids} onChange={(e) => setMadeForKids(e.target.value as "" | "false" | "true")} className={`${inputCls} w-auto py-1`}>
            <option value="" className="bg-[#111]">— 選択 —</option>
            <option value="false" className="bg-[#111]">いいえ</option>
            <option value="true" className="bg-[#111]">はい</option>
          </select>
        </label>
        {ep.disclosure && (
          <label className="flex items-center gap-2 text-xs text-amber-200">
            <input type="checkbox" checked={disclosure} onChange={(e) => setDisclosure(e.target.checked)} />
            実写と見間違えるカットがあります。YouTube Studio で「改変されたコンテンツ」を「はい」にします
          </label>
        )}
      </div>
      <Button disabled={busy || !title.trim() || !thumbnail || !madeForKids || (ep.disclosure && !disclosure)} onClick={approve}>
        承認して予約投稿する（承認D）
      </Button>
    </Card>
  );
}

function ScheduledPanel({ ep }: { ep: Episode }) {
  const posts = ep.publishPlan.posts ?? [];
  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-semibold">投稿予約済み</h3>
      <ul className="space-y-1 text-xs text-white/70">
        {posts.map((p) => (
          <li key={p.contentId}>
            {TARGET_LABEL[p.target] ?? p.target}: {new Date(p.publishAt).toLocaleString("ja-JP")} に公開
          </li>
        ))}
      </ul>
      <Link href="/posts" className="text-xs text-cyan-300 underline">
        投稿・記事で送信状況を見る
      </Link>
    </Card>
  );
}

// --- ナレーション・ジョブ ---------------------------------------------------------------

function NarrationInfo({ ep, act, busy }: { ep: Episode; act: Act; busy: boolean }) {
  if (!ep.narration.chapters?.length) return null;
  const canRedo = ["storyboard", "approve_storyboard", "final", "video", "render"].includes(ep.stage);
  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-semibold">ナレーション</h3>
      {ep.narration.estimated && <p className="text-xs text-amber-300">音声サービス（Fish Audio）または声 ID が未設定のため、文字数から尺を見積もっています。</p>}
      {(ep.narration.suspects ?? []).length > 0 && <p className="text-xs text-amber-300">読み間違いの疑い: {ep.narration.suspects!.map((s) => `${s.chapter_id}（一致率 ${Math.round(s.matchRate * 100)}%）`).join(" / ")}</p>}
      <div className="space-y-1">
        {ep.narration.chapters.map((c) => (
          <div key={c.chapter_id} className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <span className="w-12 font-mono">{c.chapter_id}</span>
            <span>{c.duration.toFixed(1)} 秒</span>
            {c.media && <audio src={media(c.media.name)} controls className="h-8" />}
          </div>
        ))}
      </div>
      {canRedo && (
        <Button variant="ghost" disabled={busy} onClick={() => act("regenerateNarration", {}, "ナレーションを作り直しています")}>
          読み辞書を反映して作り直す
        </Button>
      )}
    </Card>
  );
}

function JobsInfo({ ep }: { ep: Episode }) {
  const [open, setOpen] = useState(false);
  const failed = ep.jobs.filter((j) => j.status === "failed").length;
  return (
    <Card className="space-y-2">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-sm font-semibold">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        ジョブと更新履歴（{ep.jobs.length} 件{failed ? `・失敗 ${failed} 件` : ""}）
      </button>
      {open && (
        <div className="grid gap-4 md:grid-cols-2">
          <ul className="space-y-1 text-[11px]">
            {ep.jobs.map((j) => (
              <li key={j.id} className={j.status === "failed" ? "text-red-300" : j.status === "done" ? "text-white/50" : "text-cyan-200"}>
                {new Date(j.createdAt).toLocaleTimeString("ja-JP")} {j.step}
                {j.shotId ? `/${j.shotId}` : ""} — {j.status}
                {j.error ? `: ${j.error.slice(0, 160)}` : ""}
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-[11px] text-white/50">
            {ep.revisions.map((r) => (
              <li key={r.id}>
                {new Date(r.createdAt).toLocaleString("ja-JP")} [{r.step}] {r.reason ?? ""}（{r.by}）
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
