"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArticleEditor } from "@/components/posts/article-editor";
import { ExternalLink, ImagePlus, Quote, RefreshCw, ScissorsLineDashed, ShieldCheck, Sparkles, Tags, Trash2, X } from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { api, Badge, Button, Card, Field, inputCls, Notice, type AccountInfo, type PlatformInfo } from "@/components/settings/ui";
import { charCount, cleanPostText, formatPostText, hasBulletList, longPostMode, removeLineBreaks, SHORT_POST_CHARS, xLength, xPostLimit } from "@avatar-cmd/integrations/post-text";

/** X / Threads で実際にどう投稿されるか（アカウント設定の「200文字を超える投稿」「X Premium」に従う） */
function splitLabel(text: string, a: AccountInfo): string {
  if (!text.trim()) return "—";
  const settings = a.settings ?? {};
  const isX = a.platform === "x";
  const parts = formatPostText(text, {
    mode: longPostMode(settings),
    limit: isX ? xPostLimit(settings) : 500,
    measure: isX ? xLength : charCount,
  });
  if (parts.length > 1) return `ツリー ${parts.length}件`;
  const clean = cleanPostText(text);
  if (hasBulletList(clean)) return "1件（箇条書きは改行あり）";
  return charCount(removeLineBreaks(clean)) <= SHORT_POST_CHARS ? "1件（改行なし）" : "1件（改行あり）";
}
import { PlatformIcon } from "@/components/platform-icon";

interface MediaRef {
  name: string;
  mimeType: string;
  size: number;
  filename: string;
  alt?: string;
}

interface ReviewResult {
  verdict: "ok" | "caution" | "ng";
  summary: string;
  issues: { severity: "low" | "medium" | "high"; category: string; message: string; excerpt: string }[];
  model: string;
  /** Jev（TypeSafe）の判定。未設定なら null */
  jev: {
    action: "publish" | "review" | "hold";
    confidence?: number;
    personaFit: number;
    salesPressure: number;
    duplicateRisk: number;
    brandRisk: number;
    publish: boolean;
    reason: string;
    model: string;
  } | null;
}

const LEVEL3 = ["低", "中", "高"];
const lv = (x: number) => LEVEL3[Math.max(0, Math.min(2, Math.round(x)))];

const VERDICT: Record<ReviewResult["verdict"], { label: string; cls: string }> = {
  ok: { label: "問題なし", cls: "bg-emerald-500/15 text-emerald-300" },
  caution: { label: "要確認", cls: "bg-amber-500/15 text-amber-300" },
  ng: { label: "公開不可", cls: "bg-red-500/15 text-red-300" },
};

interface PostRow {
  id: string;
  platform: string;
  platformName: string;
  accountName: string;
  text: string;
  status: string;
  postUrl: string | null;
  note: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  category: string;
  quote: { url: string | null; authorUsername: string | null; text: string } | null;
  metrics: { views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null; engagements: number | null; error: string | null } | null;
}

interface QuoteCandidateRow {
  id: string;
  authorUsername: string | null;
  text: string;
  url: string | null;
  status: string;
  reason: string | null;
  angle: string | null;
  createdAt: string;
}

const CANDIDATE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "判定待ち", cls: "bg-white/10 text-white/50" },
  skipped: { label: "見送り", cls: "bg-white/5 text-white/40" },
  drafted: { label: "下書き作成", cls: "bg-cyan-500/15 text-cyan-300" },
  approved: { label: "承認", cls: "bg-emerald-500/15 text-emerald-300" },
  rejected: { label: "却下", cls: "bg-red-500/15 text-red-300" },
};

function QuoteScanCard({ accounts, onDrafted }: { accounts: AccountInfo[]; onDrafted: (msg: string, ok: boolean) => void }) {
  const xs = accounts.filter((a) => a.platform === "x" && a.isActive);
  const [accountId, setAccountId] = useState(xs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<QuoteCandidateRow[]>([]);
  const acc = xs.find((a) => a.id === accountId);

  const load = useCallback(async () => {
    if (!acc) return;
    try {
      setRows((await api<{ candidates: QuoteCandidateRow[] }>(`/api/quotes?avatarId=${acc.avatarId}`)).candidates);
    } catch {
      /* 一覧の失敗は無視 */
    }
  }, [acc]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  useEffect(() => {
    if (!accountId && xs[0]) setAccountId(xs[0].id);
  }, [xs, accountId]);

  async function scan() {
    setBusy(true);
    try {
      const r = await api<{ fetched: number; new: number; judged: number; drafted: number; errors: string[] }>("/api/quotes/scan", { method: "POST", json: { accountId } });
      onDrafted(
        `タイムライン ${r.fetched} 件（新規 ${r.new} 件）から ${r.judged} 件を判定し、引用案を ${r.drafted} 件下書きにしました${r.errors.length ? `（失敗 ${r.errors.length} 件: ${r.errors[0]}）` : ""}`,
        !r.errors.length || r.drafted > 0
      );
      setOpen(true);
      load();
    } catch (e) {
      onDrafted((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  if (!xs.length) return null;
  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Quote className="h-4 w-4 text-white/50" /> 引用投稿（X のタイムラインから）
      </h3>
      <p className="text-xs text-white/50">
        フォロー中の投稿から、アバターと方向性が同じ投稿を選び、肯定しつつ知見・体験を添えた引用案を下書きにします（投稿は承認制）。
        タイムラインの読み取りは1件 $0.001（このアカウント自身の開発者アプリで接続した場合）。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[200px] flex-1">
          <span className="mb-1 block text-xs text-white/60">X アカウント</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
            {xs.map((a) => (
              <option key={a.id} value={a.id} className="bg-[#111]">
                {a.accountName}（{a.avatarName}）
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" onClick={scan} disabled={busy || !accountId}>
          {busy ? "探索中…（1〜2分かかることがあります）" : "引用候補を探す"}
        </Button>
        <button onClick={() => setOpen(!open)} className="text-xs text-white/50 hover:text-white">
          {open ? "候補一覧を閉じる" : "最近の候補を見る"}
        </button>
      </div>
      {open && (
        <div className="max-h-80 space-y-2 overflow-auto">
          {rows.length === 0 ? (
            <p className="text-xs text-white/40">まだ候補はありません。</p>
          ) : (
            rows.map((c) => (
              <div key={c.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge className={CANDIDATE_STATUS[c.status]?.cls ?? "bg-white/10 text-white/50"}>{CANDIDATE_STATUS[c.status]?.label ?? c.status}</Badge>
                  <span className="text-white/60">{c.authorUsername ? `@${c.authorUsername}` : ""}</span>
                  <span className="flex-1" />
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-white/40 hover:text-white">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-white/60">{c.text}</p>
                {c.reason && <p className="mt-1 text-[11px] text-white/35">{c.reason}</p>}
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "承認待ち", cls: "bg-amber-500/15 text-amber-300" },
  SCHEDULED: { label: "予約中", cls: "bg-cyan-500/15 text-cyan-300" },
  PUBLISHING: { label: "送信中", cls: "bg-violet-500/15 text-violet-300" },
  PUBLISHED: { label: "投稿済み", cls: "bg-emerald-500/15 text-emerald-300" },
  FAILED: { label: "失敗", cls: "bg-red-500/15 text-red-300" },
};

function PostsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get("tab") === "note" ? "note" : "sns";
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [tags, setTags] = useState("");
  const [media, setMedia] = useState<MediaRef[]>([]);
  const [options, setOptions] = useState<Record<string, Record<string, string>>>({});
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [topic, setTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState<"review" | "rewrite" | "tags" | null>(null);
  const [review, setReview] = useState<(ReviewResult & { text: string }) | null>(null);

  const loadPosts = useCallback(async () => {
    try {
      setPosts((await api<{ posts: PostRow[] }>("/api/posts")).posts);
    } catch {
      /* 一覧の失敗は無視（次回更新で再取得） */
    }
  }, []);

  useEffect(() => {
    api<{ platforms: PlatformInfo[]; accounts: AccountInfo[] }>("/api/integrations")
      .then((d) => {
        setPlatforms(d.platforms);
        setAccounts(d.accounts);
      })
      .catch((e) => setNotice({ kind: "error", msg: e.message }));
    loadPosts();
    const t = setInterval(loadPosts, 10_000);
    return () => clearInterval(t);
  }, [loadPosts]);

  const byId = useMemo(() => Object.fromEntries(platforms.map((p) => [p.id, p])), [platforms]);
  const postable = accounts.filter((a) => a.isActive && byId[a.platform] && byId[a.platform].support !== "manual");
  const selectedPlatforms = [...new Set(accounts.filter((a) => selected.includes(a.id)).map((a) => a.platform))].map((id) => byId[id]).filter(Boolean);
  const needsTitle = selectedPlatforms.some((p) => p.postFields.some((f) => f.key === "title"));
  // 選択中で一番厳しい文字数制限（長文プラットフォームの大きな上限は対象外。X / Threads は自動でツリーに分けるので対象外）
  const strictest = selectedPlatforms.filter((p) => p.maxLength && p.maxLength <= 3000 && p.id !== "x" && p.id !== "threads").sort((a, b) => a.maxLength! - b.maxLength!)[0];
  const overLimit = !!strictest && [...text].length > strictest.maxLength!;
  const firstAccount = accounts.find((a) => selected.includes(a.id));

  async function runReview() {
    setAiBusy("review");
    try {
      const r = await api<ReviewResult>("/api/ai/review", { method: "POST", json: { text, avatarId: firstAccount?.avatarId, platform: firstAccount?.platform } });
      setReview({ ...r, text });
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  }

  async function runRewrite() {
    if (!strictest || !firstAccount) return;
    setAiBusy("rewrite");
    try {
      const r = await api<{ text: string; model: string; fitted: boolean }>("/api/ai/rewrite", {
        method: "POST",
        json: { avatarId: firstAccount.avatarId, text, maxLength: strictest.maxLength, platform: strictest.id },
      });
      setText(r.text);
      setNotice({ kind: "ok", msg: `${r.model} で${strictest.name}の${strictest.maxLength}文字以内に調整しました${r.fitted ? "" : "（収まらなかった分は末尾を省略）"}` });
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  }

  async function runTags() {
    setAiBusy("tags");
    try {
      const r = await api<{ tags: string[]; model: string }>("/api/ai/tags", { method: "POST", json: { text, platform: firstAccount?.platform } });
      const current = tags.split(/[,、\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
      setTags([...new Set([...current, ...r.tags])].join(", "));
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setAiBusy(null);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await api<{ media: MediaRef }>("/api/media", { method: "POST", body: fd });
        setMedia((m) => [...m, r.media]);
      }
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api("/api/posts", {
        method: "POST",
        json: {
          accountIds: selected,
          text,
          title,
          link,
          tags: tags.split(/[,、\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
          media,
          options,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        },
      });
      setNotice({ kind: "ok", msg: `${r.count} 件をキューに追加しました${scheduledAt ? "（予約）" : "。まもなく送信されます"}` });
      setText("");
      setTitle("");
      setLink("");
      setTags("");
      setMedia([]);
      setOptions({});
      setScheduledAt("");
      setReview(null);
      loadPosts();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    const first = accounts.find((a) => selected.includes(a.id));
    if (!first) return setNotice({ kind: "error", msg: "先に投稿先を選択してください（アバターのペルソナで生成します）" });
    setGenerating(true);
    try {
      const r = await api<{ text: string; model: string }>("/api/ai/generate", {
        method: "POST",
        json: { avatarId: first.avatarId, topic, platform: first.platform },
      });
      setText(r.text);
      if (!title) setTitle(topic);
      setNotice({ kind: "ok", msg: `${r.model} で生成しました。内容を確認してから投稿してください` });
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  async function approve(id: string, newText?: string) {
    try {
      await api(`/api/posts/${id}/approve`, { method: "POST", json: { text: newText } });
      setEditing(null);
      setNotice({ kind: "ok", msg: "承認して送信キューに追加しました" });
      loadPosts();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }
  async function saveDraft(id: string, newText: string) {
    try {
      await api(`/api/posts/${id}`, { method: "PATCH", json: { text: newText } });
      setEditing(null);
      loadPosts();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }

  async function retry(id: string) {
    try {
      await api(`/api/posts/${id}/retry`, { method: "POST" });
      loadPosts();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }
  async function remove(id: string) {
    if (!confirm("この投稿を削除しますか？")) return;
    try {
      await api(`/api/posts/${id}`, { method: "DELETE" });
      loadPosts();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <div className="flex min-h-screen bg-[#0b0c0f] text-white">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header title="投稿・記事" description="SNSへの投稿・予約・送信状況と、note 記事（画像・図解・有料ライン）" />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto mb-5 flex w-full max-w-6xl gap-1">
            <div className="flex gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
              {(
                [
                  ["sns", "SNS 投稿"],
                  ["note", "note 記事"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => router.replace(k === "sns" ? "/posts" : "/posts?tab=note")}
                  className={`rounded-lg px-4 py-1.5 text-sm transition ${view === k ? "bg-white/10 font-semibold text-white" : "text-white/50 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {view === "note" ? (
            <div className="mx-auto max-w-6xl">
              <ArticleEditor accounts={accounts} onPosted={() => loadPosts()} />
            </div>
          ) : (
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              {notice && (
                <Notice kind={notice.kind} onClose={() => setNotice(null)}>
                  {notice.msg}
                </Notice>
              )}
              <Card className="space-y-4">
                <h3 className="text-sm font-semibold">投稿先</h3>
                {postable.length === 0 ? (
                  <p className="text-xs text-white/50">
                    投稿できるアカウントがありません。
                    <Link href="/settings?tab=accounts" className="text-cyan-300 underline">
                      設定 → アカウント
                    </Link>
                    から接続してください。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {postable.map((a) => {
                      const on = selected.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          onClick={() => setSelected(on ? selected.filter((x) => x !== a.id) : [...selected, a.id])}
                          className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                            on ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60 hover:text-white"
                          }`}
                        >
                          <PlatformIcon platform={a.platform} /> {a.accountName}
                          <span className="ml-1 text-white/30">({a.avatarName})</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              <QuoteScanCard
                accounts={accounts}
                onDrafted={(msg, ok) => {
                  setNotice({ kind: ok ? "ok" : "error", msg });
                  loadPosts();
                }}
              />

              <Card className="space-y-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field def={{ key: "topic", label: "AIで下書き（トピック）", placeholder: "例: 朝のルーティン" }} value={topic} onChange={setTopic} />
                  </div>
                  <Button variant="ghost" onClick={generate} disabled={generating || !topic.trim() || !selected.length}>
                    <Sparkles className="inline h-3.5 w-3.5" /> {generating ? "生成中…" : "生成"}
                  </Button>
                </div>
                {needsTitle && <Field def={{ key: "title", label: "タイトル（記事・動画・Reddit 用）" }} value={title} onChange={setTitle} />}
                <label className="block">
                  <span className="mb-1 block text-xs text-white/60">本文（Markdown 可: WordPress / note / Zenn / Medium）</span>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className={inputCls} />
                </label>
                {selectedPlatforms.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {accounts
                      .filter((a) => selected.includes(a.id) && (a.platform === "x" || a.platform === "threads"))
                      .map((a) => (
                        <Badge key={a.id} className="bg-white/5 text-white/50">
                          {byId[a.platform]?.name} {a.accountName}: {[...text].length}文字 → {splitLabel(text, a)}
                        </Badge>
                      ))}
                    {selectedPlatforms
                      .filter((p) => p.maxLength && p.id !== "x" && p.id !== "threads")
                      .map((p) => {
                        const over = [...text].length > p.maxLength!;
                        return (
                          <Badge key={p.id} className={over ? "bg-red-500/15 text-red-300" : "bg-white/5 text-white/50"}>
                            {p.name}: {[...text].length}/{p.maxLength}
                          </Badge>
                        );
                      })}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" type="button" onClick={runReview} disabled={!!aiBusy || !text.trim()}>
                    <ShieldCheck className="inline h-3.5 w-3.5" /> {aiBusy === "review" ? "チェック中…" : "AIでチェック"}
                  </Button>
                  {overLimit && (
                    <Button variant="ghost" type="button" onClick={runRewrite} disabled={!!aiBusy}>
                      <ScissorsLineDashed className="inline h-3.5 w-3.5" /> {aiBusy === "rewrite" ? "調整中…" : `AIで${strictest!.maxLength}文字に調整`}
                    </Button>
                  )}
                </div>
                {review && (
                  <div className="space-y-2 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge className={VERDICT[review.verdict].cls}>{VERDICT[review.verdict].label}</Badge>
                      <span className="flex-1 text-white/70">{review.summary}</span>
                      <button onClick={() => setReview(null)} className="text-white/40 hover:text-white" title="閉じる">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {review.text !== text && <p className="text-[11px] text-white/35">本文が変更されています。再チェックしてください。</p>}
                    {review.issues.map((i, n) => (
                      <div key={n} className="border-l-2 border-white/10 pl-2">
                        <span className={i.severity === "high" ? "text-red-300" : i.severity === "medium" ? "text-amber-300" : "text-white/50"}>[{i.category}]</span>{" "}
                        <span className="text-white/70">{i.message}</span>
                        {i.excerpt && <span className="mt-0.5 block text-white/35">「{i.excerpt}」</span>}
                      </div>
                    ))}
                    {review.jev && (
                      <div className="rounded-lg border border-violet-400/20 bg-violet-500/[0.05] p-2 text-[11px] text-white/60">
                        <span className={review.jev.publish ? "text-emerald-300" : "text-amber-300"}>Jev: {review.jev.reason}</span>
                        <span className="ml-2 text-white/40">
                          判定 {review.jev.action}
                          {review.jev.confidence !== undefined && `（${Math.round(review.jev.confidence * 100)}%）`}・口調の一致 {lv(review.jev.personaFit)}・宣伝色 {lv(review.jev.salesPressure)}・重複{" "}
                          {Math.round(review.jev.duplicateRisk * 100)}%・ブランドリスク {lv(review.jev.brandRisk)}
                        </span>
                      </div>
                    )}
                    <p className="text-[11px] text-white/30">
                      {review.model}
                      {review.jev ? ` ／ ${review.jev.model}` : ""} によるチェック。最終判断はご自身で行ってください。
                    </p>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field def={{ key: "link", label: "リンク（任意）", type: "url", placeholder: "https://" }} value={link} onChange={setLink} />
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field def={{ key: "tags", label: "タグ（カンマ区切り）", placeholder: "AI, 副業" }} value={tags} onChange={setTags} />
                    </div>
                    <Button variant="ghost" type="button" onClick={runTags} disabled={!!aiBusy || !text.trim()}>
                      <Tags className="inline h-3.5 w-3.5" /> {aiBusy === "tags" ? "提案中…" : "AIで提案"}
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Button variant="ghost" type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      <ImagePlus className="inline h-3.5 w-3.5" /> {uploading ? "アップロード中…" : "画像・動画を追加"}
                    </Button>
                    <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" hidden onChange={(e) => upload(e.target.files)} />
                  </div>
                  {media.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {media.map((m) => (
                        <div key={m.name} className="relative h-20 w-20 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                          {m.mimeType.startsWith("image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/media/${m.name}`} alt={m.filename} className="h-full w-full object-cover" />
                          ) : (
                            <video src={`/media/${m.name}`} className="h-full w-full object-cover" muted />
                          )}
                          <button onClick={() => setMedia(media.filter((x) => x.name !== m.name))} className="absolute right-1 top-1 rounded bg-black/70 p-0.5">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedPlatforms
                  .filter((p) => p.postFields.some((f) => f.key !== "title"))
                  .map((p) => (
                    <div key={p.id} className="grid gap-3 rounded-xl border border-white/[0.06] p-3 md:grid-cols-2">
                      {p.postFields
                        .filter((f) => f.key !== "title")
                        .map((f) => (
                          <Field
                            key={f.key}
                            def={{ ...f, label: `${p.name}: ${f.label}` }}
                            value={options[p.id]?.[f.key] ?? ""}
                            onChange={(v) => setOptions({ ...options, [p.id]: { ...options[p.id], [f.key]: v } })}
                          />
                        ))}
                    </div>
                  ))}

                <label className="block">
                  <span className="mb-1 block text-xs text-white/60">予約日時（空欄なら今すぐ）</span>
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={inputCls} />
                </label>
                <Button onClick={submit} disabled={busy || !selected.length || !text.trim()}>
                  {busy ? "登録中…" : scheduledAt ? "予約する" : "投稿する"}
                </Button>
              </Card>
            </div>

            <Card className="h-fit">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">送信状況</h3>
                <button onClick={loadPosts} className="text-white/40 hover:text-white" title="更新">
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              {posts.length === 0 ? (
                <p className="text-xs text-white/40">まだ投稿はありません。</p>
              ) : (
                <div className="space-y-2">
                  {posts.map((p) => (
                    <div key={p.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge className={STATUS[p.status]?.cls ?? "bg-white/10 text-white/50"}>{STATUS[p.status]?.label ?? p.status}</Badge>
                        <span className="font-medium">{p.platformName}</span>
                        <span className="text-white/40">{p.accountName}</span>
                        <span className="flex-1" />
                        <span className="text-white/30">
                          {new Date(p.publishedAt ?? p.scheduledAt ?? p.createdAt).toLocaleString("ja-JP")}
                        </span>
                      </div>
                      {editing?.id === p.id ? (
                        <textarea
                          value={editing.text}
                          onChange={(e) => setEditing({ id: p.id, text: e.target.value })}
                          rows={6}
                          className={`${inputCls} mt-2 text-xs`}
                        />
                      ) : (
                        <p className={`mt-2 whitespace-pre-wrap text-xs text-white/70 ${p.status === "DRAFT" ? "" : "line-clamp-2"}`}>{p.text}</p>
                      )}
                      {p.quote && (
                        <div className="mt-2 rounded-lg border-l-2 border-white/15 bg-white/[0.02] px-2 py-1 text-[11px] text-white/45">
                          <span className="text-white/60">引用元 {p.quote.authorUsername ? `@${p.quote.authorUsername}` : ""}</span>
                          {p.quote.url && (
                            <a href={p.quote.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-white/40 hover:text-white">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <span className="mt-0.5 line-clamp-2 block">{p.quote.text}</span>
                          {p.platform === "x" && p.status !== "PUBLISHED" && <span className="mt-0.5 block text-[10px] text-white/35">投稿時に元投稿の URL を本文の末尾に入れます（前後に半角スペース）</span>}
                        </div>
                      )}
                      {p.metrics && (
                        <p className="mt-1 text-[11px] text-white/40">
                          {p.metrics.error && p.metrics.engagements === null
                            ? `反応: 取得できません（${p.metrics.error}）`
                            : `表示 ${p.metrics.views ?? "—"}・いいね ${p.metrics.likes ?? 0}・返信 ${p.metrics.replies ?? 0}・リポスト ${p.metrics.reposts ?? 0}・引用 ${p.metrics.quotes ?? 0}`}
                        </p>
                      )}
                      {p.note && <p className="mt-1 text-[11px] text-amber-300/80">{p.note}</p>}
                      {p.lastError && p.status !== "PUBLISHED" && <p className="mt-1 break-all text-[11px] text-red-300">{p.lastError}</p>}
                      <div className="mt-2 flex gap-3 text-xs">
                        {p.postUrl && (
                          <a href={p.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-300">
                            開く <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {p.status === "DRAFT" &&
                          (editing?.id === p.id ? (
                            <>
                              <button onClick={() => approve(p.id, editing.text)} className="text-emerald-300">
                                保存して承認
                              </button>
                              <button onClick={() => saveDraft(p.id, editing.text)} className="text-cyan-300">
                                保存
                              </button>
                              <button onClick={() => setEditing(null)} className="text-white/50">
                                キャンセル
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => approve(p.id)} className="text-emerald-300">
                                承認して投稿
                              </button>
                              <button onClick={() => setEditing({ id: p.id, text: p.text })} className="text-cyan-300">
                                編集
                              </button>
                            </>
                          ))}
                        {p.status === "FAILED" && (
                          <button onClick={() => retry(p.id)} className="text-cyan-300">
                            再送
                          </button>
                        )}
                        {(p.status === "FAILED" || p.status === "SCHEDULED" || p.status === "DRAFT") && (
                          <button onClick={() => remove(p.id)} className="inline-flex items-center gap-1 text-red-300">
                            <Trash2 className="h-3 w-3" /> 削除
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function PostsPage() {
  return (
    <Suspense>
      <PostsInner />
    </Suspense>
  );
}
