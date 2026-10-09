"use client";
// note 記事エディタ: 本文（AI 下書き）→ 見出しごとの画像・図解の目印 → 生成 → 見出し画像・価格・有料ライン → note の下書きへ
// ・本文は Markdown のまま編集できる。目印は <!-- image: … --> / <!-- infographic: … -->、有料ラインは <!-- paywall -->
// ・作った画像は ![説明](media:{name}) として本文に入り、投稿時に添付される（note には自動でアップロード）
// ・入稿のしかた: 下書きに保存（公開は note の編集画面で）/ 公開まで行う / 予約公開（指定時刻に公開まで）
// ・「新しく書き始める」で書きかけ（この端末に保存）を消して空から書ける
// ・記事テンプレート（構成・価格・タグ・画像の入れ方・入稿のしかた）を適用でき、テーマだけで全自動の記事作成（kind: full）もできる
// ・AI の執筆・画像/図解・見出し画像はバックグラウンドのジョブ（/api/articles/jobs）。ページを離れても生成は続き、戻ると結果が反映される
// ・AI で書くときは、タイトル・テーマ・本文のうち入力済みのものを活かし、足りない部分だけを AI が補う
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ImageIcon, ImagePlus, Loader2, Lock, Rocket, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { api, Badge, Button, Card, inputCls, Notice, type AccountInfo } from "@/components/settings/ui";
import { ArticleTemplates, templateSummary, type ArticleTemplate } from "./article-templates";

interface MediaRef {
  name: string;
  mimeType: string;
  size: number;
  filename: string;
  alt?: string;
}
interface Marker {
  index: number;
  line: number;
  kind: "image" | "infographic";
  description: string;
}

const MARKER = /^\s*<!--\s*(paywall|image|infographic)\s*(?::\s*([\s\S]*?))?\s*-->\s*$/;
const DRAFT_KEY = "avatar-cmd:note-draft";
const JOBS_KEY = "avatar-cmd:note-jobs";

type JobKind = "write" | "render" | "eyecatch" | "full";
type SubmitMode = "draft" | "publish" | "schedule";
/** 依頼中のジョブ（この端末のブラウザに保存し、ページを離れて戻っても結果を受け取る） */
interface PendingJob {
  id: string;
  kind: JobKind;
  /** render の対象（"all" か目印の番号） */
  target?: string;
  progress?: string | null;
}
interface JobView {
  id: string;
  kind: JobKind;
  status: "queued" | "running" | "done" | "failed";
  progress: string | null;
  result: any;
  error: string | null;
}
const JOB_LABEL: Record<JobKind, string> = { write: "記事の執筆", render: "画像・図解の作成", eyecatch: "見出し画像の生成", full: "全自動の記事作成" };

/** テンプレートの構成・タイトル・有料ラインの指示（サーバーの templatePrompt と同じ形） */
function templatePrompt(t: ArticleTemplate | undefined): string {
  if (!t) return "";
  return [
    t.structure && `記事の構成・書き方（この型に沿って書く）:\n${t.structure}`,
    t.titleHint && `タイトルの付け方: ${t.titleHint}`,
    t.paid && t.paywallHint && `有料ライン（<!-- paywall -->）の位置: ${t.paywallHint}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** datetime-local の初期値（1 時間後・5 分単位） */
function inAnHour(): string {
  const d = new Date(Date.now() + 3600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function markers(md: string): Marker[] {
  const out: Marker[] = [];
  md.split("\n").forEach((l, line) => {
    const m = MARKER.exec(l);
    if (m && m[1] !== "paywall") out.push({ index: out.length, line, kind: m[1] as Marker["kind"], description: (m[2] ?? "").trim() });
  });
  return out;
}
const mediaNames = (md: string) => [...new Set([...md.matchAll(/!\[[^\]]*\]\(media:([^)\s]+)\)/g)].map((m) => m[1]))];
const hasPaywall = (md: string) => md.split("\n").some((l) => /^\s*<!--\s*paywall\s*-->\s*$/.test(l));

/** 簡易プレビュー（note での見え方に近い形） */
function Preview({ md, title, eyecatch }: { md: string; title: string; eyecatch: string | null }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>));
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  const flush = (k: string) => {
    if (para.length) blocks.push(<p key={k} className="my-3 leading-7">{para.map((l, i) => <span key={i}>{bold(l)}{i < para.length - 1 && <br />}</span>)}</p>);
    para = [];
  };
  md.split("\n").forEach((l, i) => {
    const h = /^\s*(#{1,6})\s+(.+)$/.exec(l);
    const img = /^\s*!\[([^\]]*)\]\(media:([^)\s]+)\)\s*$/.exec(l);
    const mk = MARKER.exec(l);
    if (!l.trim()) return flush(`p${i}`);
    flush(`p${i}`);
    if (h) blocks.push(h[1].length <= 2 ? <h2 key={i} className="mt-8 border-b border-black/10 pb-1 text-xl font-bold">{bold(h[2])}</h2> : <h3 key={i} className="mt-6 text-lg font-bold">{bold(h[2])}</h3>);
    // eslint-disable-next-line @next/next/no-img-element
    else if (img) blocks.push(<figure key={i} className="my-4"><img src={`/media/${img[2]}`} alt={img[1]} className="w-full rounded" /><figcaption className="mt-1 text-center text-xs text-black/50">{img[1]}</figcaption></figure>);
    else if (mk?.[1] === "paywall")
      blocks.push(
        <div key={i} className="my-6 flex items-center gap-2 text-xs font-semibold text-[#2cb696]">
          <span className="h-px flex-1 bg-[#2cb696]/40" /> <Lock className="h-3.5 w-3.5" /> ここから有料 <span className="h-px flex-1 bg-[#2cb696]/40" />
        </div>
      );
    else if (mk) blocks.push(<div key={i} className="my-4 rounded border border-dashed border-black/20 p-6 text-center text-xs text-black/40">［{mk[1] === "image" ? "イメージ画像" : "図解"}：{mk[2]}］（未作成）</div>);
    else if (/^\s*[-*+]\s+/.test(l)) blocks.push(<li key={i} className="ml-5 list-disc">{bold(l.replace(/^\s*[-*+]\s+/, ""))}</li>);
    else if (/^\s*>/.test(l)) blocks.push(<blockquote key={i} className="my-3 border-l-4 border-black/15 pl-3 text-black/60">{bold(l.replace(/^\s*>\s?/, ""))}</blockquote>);
    else para.push(l);
  });
  flush("end");
  return (
    <div className="rounded-xl bg-white p-6 text-[15px] text-[#222]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {eyecatch && <img src={`/media/${eyecatch}`} alt="見出し画像" className="mb-4 w-full rounded" />}
      <h1 className="text-2xl font-bold">{title || "（タイトル未入力）"}</h1>
      {blocks}
    </div>
  );
}

/** AI で書くボタンの文言（何を元に書くかが分かるように） */
function writeLabel(title: string, topic: string, md: string): string {
  const t = !!title.trim();
  const p = !!topic.trim();
  if (md.trim()) return "本文を整えて仕上げる";
  if (t && p) return "タイトルとテーマから書く";
  if (t) return "タイトルから書く";
  if (p) return "テーマから書く";
  return "AI で書く";
}

/** 入力欄ごとに、AI で書くとどう扱われるかを示す */
function InputState({ filled, preserve, body }: { filled: boolean; preserve: boolean; body?: boolean }) {
  if (!filled) return <Badge className="bg-white/10 text-white/50">空 → AI が{body ? "全文を書く" : "作る"}</Badge>;
  return <Badge className="bg-emerald-500/15 text-emerald-300">入力済み → {preserve ? (body ? "そのまま残して足す" : "そのまま使う") : body ? "活かして補う" : "活かして整える"}</Badge>;
}

export function ArticleEditor({ accounts, onPosted }: { accounts: AccountInfo[]; onPosted?: () => void }) {
  const notes = accounts.filter((a) => a.platform === "note" && a.isActive);
  const [accountId, setAccountId] = useState("");
  const [topic, setTopic] = useState("");
  const [paid, setPaid] = useState(false);
  const [title, setTitle] = useState("");
  const [md, setMd] = useState("");
  const [price, setPrice] = useState("");
  const [tags, setTags] = useState("");
  const [eyecatch, setEyecatch] = useState<MediaRef | null>(null);
  const [media, setMedia] = useState<Record<string, MediaRef>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [preserve, setPreserve] = useState(false);
  const [jobs, setJobs] = useState<PendingJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState<ArticleTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [mode, setMode] = useState<SubmitMode>("draft");
  const [scheduleAt, setScheduleAt] = useState(inAnHour);
  const [autoTopic, setAutoTopic] = useState("");
  const [autoTemplateId, setAutoTemplateId] = useState("");
  const [autoMode, setAutoMode] = useState<SubmitMode | "template">("template");
  const [autoAt, setAutoAt] = useState(inAnHour);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const eyeRef = useRef<HTMLInputElement>(null);

  const account = notes.find((a) => a.id === accountId) ?? notes[0];
  const avatarId = account?.avatarId;
  const list = useMemo(() => markers(md), [md]);
  const template = templates.find((t) => t.id === templateId);

  const loadTemplates = useCallback(() => {
    api<{ templates: ArticleTemplate[] }>("/api/articles/templates")
      .then((d) => setTemplates(d.templates))
      .catch(() => undefined);
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

  // 書きかけは、この端末のブラウザにだけ保存する（失っても困らない補助）
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
      if (d) {
        setTopic(d.topic ?? "");
        setPaid(!!d.paid);
        setTitle(d.title ?? "");
        setMd(d.md ?? "");
        setPrice(d.price ?? "");
        setTags(d.tags ?? "");
        setEyecatch(d.eyecatch ?? null);
        setMedia(d.media ?? {});
        setTemplateId(d.templateId ?? "");
      }
    } catch {
      /* 読めなければ空から */
    }
    try {
      setJobs(JSON.parse(localStorage.getItem(JOBS_KEY) ?? "[]"));
    } catch {
      /* 読めなければ無し */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ topic, paid, title, md, price, tags, eyecatch, media, templateId }));
      } catch {
        /* 保存できない環境では何もしない */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [topic, paid, title, md, price, tags, eyecatch, media, templateId]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
    } catch {
      /* 保存できない環境では何もしない */
    }
  }, [jobs, loaded]);

  // --- バックグラウンドのジョブ --------------------------------------------------

  const jobFor = (kind: JobKind, target?: string) => jobs.find((j) => j.kind === kind && (target === undefined || j.target === target));
  const writing = !!jobFor("write");

  /** 終わったジョブの結果を、今の本文に反映する */
  const applyJob = useCallback((pending: PendingJob, job: JobView) => {
    if (job.status === "failed") {
      setNotice({ kind: "error", msg: `${JOB_LABEL[job.kind]}に失敗しました: ${job.error ?? "不明なエラー"}` });
      return;
    }
    const r = job.result ?? {};
    if (job.kind === "full") {
      const where = r.publish === "publish" ? (r.scheduledAt ? `${new Date(r.scheduledAt).toLocaleString("ja-JP")} に公開する予約` : "公開") : r.scheduledAt ? `${new Date(r.scheduledAt).toLocaleString("ja-JP")} に下書き保存する予約` : "下書き保存";
      const made = [r.images ? `画像・図解 ${r.images} 枚` : "", r.eyecatch ? "見出し画像" : ""].filter(Boolean).join("・");
      const warn: string[] = r.warnings ?? [];
      setNotice({
        kind: warn.length ? "error" : "ok",
        msg: `全自動で「${r.title}」を作り、${where}に回しました${made ? `（${made}）` : ""}。結果は「SNS 投稿」の一覧に出ます${warn.length ? ` ／ 注意: ${warn.join(" / ")}` : ""}`,
      });
      onPosted?.();
      return;
    }
    if (job.kind === "write") {
      setTitle(r.title ?? "");
      if (r.topic) setTopic(r.topic);
      setMd(r.markdown ?? "");
      setNotice({ kind: "ok", msg: "記事を書きました。内容を確認して、必要なら直してください" });
    } else if (job.kind === "eyecatch") {
      if (r.media) setEyecatch(r.media);
      setNotice({ kind: "ok", msg: "見出し画像（1280×670）を作りました" });
    } else if (job.kind === "render") {
      const reps: { marker: string; replacement: string }[] = r.replacements ?? [];
      // 生成中に本文が編集されていても、目印の行だけを画像に置き換える
      setMd((cur) => {
        const missed: string[] = [];
        const lines = cur.split("\n");
        for (const x of reps) {
          const i = lines.findIndex((l) => l.trim() === x.marker.trim());
          if (i === -1) missed.push(x.replacement);
          else lines[i] = x.replacement;
        }
        // 目印が消されていた画像は末尾に足す（作った画像を失わない）
        return missed.length ? `${lines.join("\n")}\n\n${missed.join("\n\n")}` : lines.join("\n");
      });
      const made: MediaRef[] = r.media ?? [];
      setMedia((cur) => ({ ...cur, ...Object.fromEntries(made.map((m) => [m.name, m])) }));
      const errors: { description: string; error: string }[] = (r.results ?? []).filter((x: any) => x.error);
      setNotice(
        errors.length
          ? { kind: "error", msg: `${made.length} 件作成、${errors.length} 件失敗: ${errors.map((e) => `${e.description}（${e.error}）`).join(" / ")}` }
          : { kind: "ok", msg: `${made.length} 件の画像・図解を作りました` }
      );
    }
  }, [onPosted]);

  // 依頼中のジョブを数秒ごとに確認する（ページを離れている間も生成は続き、戻ったときに結果を受け取る）
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const polling = jobs.length > 0;
  useEffect(() => {
    if (!polling) return;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        for (const p of jobsRef.current) {
          try {
            const { job } = await api<{ job: JobView }>(`/api/articles/jobs/${p.id}`);
            if (job.status === "done" || job.status === "failed") {
              setJobs((cur) => cur.filter((j) => j.id !== p.id));
              applyJob(p, job);
            } else if (job.progress !== p.progress) {
              setJobs((cur) => cur.map((j) => (j.id === p.id ? { ...j, progress: job.progress } : j)));
            }
          } catch (e) {
            // ジョブが消えていたら待つのをやめる（それ以外の失敗は次の確認で再試行）
            if (/見つかりません/.test((e as Error).message)) setJobs((cur) => cur.filter((j) => j.id !== p.id));
          }
        }
      } finally {
        inFlight = false;
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [polling, applyJob]);

  async function startJob(kind: JobKind, input: Record<string, unknown>, target?: string) {
    const r = await run(`start-${kind}`, () => api<{ job: JobView }>("/api/articles/jobs", { method: "POST", json: { kind, avatarId, input } }));
    if (r) setJobs((cur) => [...cur, { id: r.job.id, kind, target, progress: r.job.progress }]);
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  function generate() {
    void startJob("write", { title, topic, markdown: md, paid, preserve, extraPrompt: templatePrompt(template) || undefined });
  }

  /** テンプレートの有料・価格・タグを入れる（構成の指示は AI で書くときに渡す） */
  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setPaid(t.paid);
    setPrice(t.paid && t.price ? String(t.price) : "");
    if (t.tags.length) setTags(t.tags.join(", "));
    setMode(t.publish === "publish" ? "publish" : "draft");
    setNotice({ kind: "ok", msg: `テンプレート「${t.name}」を適用しました（${templateSummary(t)}）。AI で書くときは、このテンプレートの構成に沿って書きます` });
  }

  /** 書きかけを消して空から書き始める（全自動のジョブはそのまま続ける） */
  function reset() {
    const has = title.trim() || topic.trim() || md.trim() || eyecatch || price || tags;
    if (has && !confirm("書きかけの記事（タイトル・テーマ・本文・画像・見出し画像・価格・タグ）を消して、新しく書き始めますか？\n※ 元に戻せません")) return;
    setTitle("");
    setTopic("");
    setMd("");
    setPrice("");
    setTags("");
    setPaid(false);
    setEyecatch(null);
    setMedia({});
    setTemplateId("");
    setPreserve(false);
    setProblems([]);
    setShowPreview(false);
    setMode("draft");
    setScheduleAt(inAnHour());
    // 書きかけの記事に向けた執筆・画像のジョブは結果を受け取らない（新しい記事に混ざらないように）
    setJobs((cur) => cur.filter((j) => j.kind === "full"));
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* 保存できない環境では何もしない */
    }
    setNotice({ kind: "ok", msg: "新しい記事を書き始められます" });
  }

  /** テーマだけから 執筆 → 画像 → 見出し画像 → 入稿 まで全自動で作る */
  function runFull() {
    const t = templates.find((x) => x.id === autoTemplateId);
    const publish = autoMode === "template" ? t?.publish ?? "draft" : autoMode === "draft" ? "draft" : "publish";
    let scheduledAt: string | undefined;
    if (autoMode === "schedule") {
      const at = new Date(autoAt);
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000) return setNotice({ kind: "error", msg: "予約日時は 1 分以上先を指定してください" });
      scheduledAt = at.toISOString();
    }
    if (publish === "publish" && !confirm(`「${autoTopic}」の記事を AI が書き、${scheduledAt ? `${new Date(scheduledAt).toLocaleString("ja-JP")} に` : "でき次第"} note で公開します。よろしいですか？`)) return;
    void startJob("full", { accountId: account?.id, templateId: autoTemplateId || undefined, topic: autoTopic, publish, scheduledAt });
  }

  async function plan() {
    const r = await run("plan", () => api<{ markdown: string; plan: unknown[] }>("/api/articles/plan", { method: "POST", json: { markdown: md } }));
    if (r) {
      setMd(r.markdown);
      setNotice({ kind: "ok", msg: `${r.plan.length} か所に画像・図解の目印を入れました。内容を直してから「作る」を押してください` });
    }
  }

  function render(only?: number[]) {
    void startJob("render", { markdown: md, only }, only ? String(only[0]) : "all");
  }

  function insertAtCursor(snippet: string) {
    const el = textRef.current;
    const pos = el ? el.selectionStart : md.length;
    // 行の途中なら次の行に入れる
    const lineEnd = md.indexOf("\n", pos);
    const at = lineEnd === -1 ? md.length : lineEnd;
    setMd(`${md.slice(0, at)}\n\n${snippet}\n${md.slice(at)}`);
  }

  function insertPaywall() {
    const without = md
      .split("\n")
      .filter((l) => !/^\s*<!--\s*paywall\s*-->\s*$/.test(l))
      .join("\n");
    const el = textRef.current;
    const pos = Math.min(el ? el.selectionStart : without.length, without.length);
    const lineEnd = without.indexOf("\n", pos);
    const at = lineEnd === -1 ? without.length : lineEnd;
    setMd(`${without.slice(0, at)}\n\n<!-- paywall -->\n${without.slice(at)}`);
  }

  async function uploadFile(file: File | null, asEyecatch = false) {
    if (!file) return;
    const ref = await run("upload", async () => {
      const form = new FormData();
      form.append("file", file);
      // 見出し画像は note のサムネイルサイズ（1280×670）に切り抜く
      if (asEyecatch) form.append("fit", "eyecatch");
      const r = await fetch("/api/media", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "アップロードに失敗しました");
      return d.media as MediaRef;
    });
    if (!ref) return;
    if (asEyecatch) setEyecatch({ ...ref, alt: "eyecatch" });
    else {
      setMedia((cur) => ({ ...cur, [ref.name]: ref }));
      insertAtCursor(`![${file.name.replace(/\.[^.]+$/, "")}](media:${ref.name})`);
    }
  }

  function makeEyecatch() {
    void startJob("eyecatch", { title, summary: md.slice(0, 400) });
  }

  function check(): string[] {
    const out: string[] = [];
    if (!account) out.push("note のアカウントが接続されていません（設定 > アカウント）");
    if (!title.trim()) out.push("タイトルを入力してください");
    if (!md.trim()) out.push("本文が空です");
    const p = price.replace(/[,，¥円\s]/g, "");
    if (p && (!/^\d+$/.test(p) || Number(p) < 100 || Number(p) > 50000)) out.push("価格は 100〜50,000 円の整数で入力してください");
    if (p && Number(p) >= 100 && !hasPaywall(md)) out.push("有料記事には有料ライン（<!-- paywall -->）が必要です");
    if (list.length) out.push(`まだ作っていない画像・図解の目印が ${list.length} か所あります（そのまま保存すると［画像：…］の文字になります）`);
    const missing = mediaNames(md).filter((n) => !media[n]);
    if (missing.length) out.push(`添付が見つからない画像があります: ${missing.join(", ")}`);
    if (mode === "schedule") {
      const at = new Date(scheduleAt);
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000) out.push("予約日時は 1 分以上先を指定してください");
    }
    return out;
  }

  async function submit() {
    const issues = check().filter((x) => !x.startsWith("まだ作っていない"));
    const warn = check().filter((x) => x.startsWith("まだ作っていない"));
    setProblems([...issues, ...warn]);
    if (issues.length) return;
    if (warn.length && !confirm(`${warn[0]}\nこのまま保存しますか？`)) return;
    const at = mode === "schedule" ? new Date(scheduleAt) : undefined;
    if (mode !== "draft" && !confirm(`「${title.trim()}」を note で${at ? ` ${at.toLocaleString("ja-JP")} に` : "すぐに"}公開します${price ? `（有料 ${price} 円）` : ""}。よろしいですか？`)) return;
    const refs = mediaNames(md).map((n) => media[n]);
    if (eyecatch) refs.push(eyecatch);
    const ok = await run("submit", () =>
      api("/api/posts", {
        method: "POST",
        json: {
          accountIds: [account!.id],
          text: md,
          title: title.trim(),
          tags: tags.split(/[,、\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
          media: refs,
          options: { note: { title: title.trim(), price: price.replace(/[,，¥円\s]/g, ""), eyecatch: eyecatch?.name ?? "", mode: mode === "draft" ? "draft" : "publish" } },
          ...(at ? { scheduledAt: at.toISOString() } : {}),
        },
      })
    );
    if (ok !== undefined) {
      setNotice({
        kind: "ok",
        msg:
          mode === "draft"
            ? "note への下書き保存を予約しました。1 分ほどで「SNS 投稿」の一覧に編集画面のリンクが出ます（公開は note の編集画面で）"
            : mode === "publish"
              ? "note への公開を予約しました。1 分ほどで「SNS 投稿」の一覧に記事のリンクが出ます（公開に失敗した場合は下書きとして残り、理由が表示されます）"
              : `${at!.toLocaleString("ja-JP")} に note で公開する予約をしました（「SNS 投稿」の一覧で確認・取り消しできます）`,
      });
      onPosted?.();
    }
  }

  if (!notes.length) {
    return (
      <Card>
        <p className="text-sm text-white/60">note のアカウントが接続されていません。設定 &gt; アカウント から note を接続すると、ここで記事を書いて下書きに保存できます。</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-white/60">
            note アカウント
            <select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)} className={`${inputCls} mt-1 w-64`}>
              {notes.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#111]">
                  {a.avatarName} / {a.accountName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/60">
            テンプレート
            <select value={templateId} onChange={(e) => applyTemplate(e.target.value)} className={`${inputCls} mt-1 w-56`}>
              <option value="" className="bg-[#111]">
                使わない
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#111]">
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-white/60">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> 有料記事
          </label>
          <span className="flex-1" />
          <Button variant="ghost" disabled={writing} onClick={reset} title="書きかけを消して空から書き始める">
            <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> 新しく書き始める
          </Button>
        </div>
        {template && <p className="-mt-1 text-[11px] text-cyan-200/70">テンプレート「{template.name}」: {templateSummary(template)}。AI で書くときはこの構成に沿います。</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs text-white/60">
            <span className="flex items-center gap-2">
              タイトル <InputState filled={!!title.trim()} preserve={preserve} />
            </span>
            <input value={title} readOnly={writing} onChange={(e) => setTitle(e.target.value)} placeholder="例: ADHD の私が 3 年続けている朝の集中ルーティン" className={`${inputCls} mt-1 text-base font-semibold`} />
          </label>
          <label className="block text-xs text-white/60">
            <span className="flex items-center gap-2">
              テーマ <InputState filled={!!topic.trim()} preserve={preserve} />
            </span>
            <input value={topic} readOnly={writing} onChange={(e) => setTopic(e.target.value)} placeholder="例: ADHD でも続く朝の集中ルーティン" className={`${inputCls} mt-1 text-base`} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
          <span className="flex items-center gap-2">
            本文 <InputState filled={!!md.trim()} preserve={preserve} body />
          </span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={preserve} onChange={(e) => setPreserve(e.target.checked)} /> 入力済みの部分は書き換えない（足りない部分だけ書く）
          </label>
          <span className="flex-1" />
          <Button disabled={!!busy || writing || !account || (!title.trim() && !topic.trim() && !md.trim())} onClick={generate}>
            <Sparkles className="mr-1 inline h-3.5 w-3.5" />
            {writing ? "執筆中…" : writeLabel(title, topic, md)}
          </Button>
        </div>
        <p className="text-[11px] text-white/40">
          タイトルだけ・テーマだけ・両方・書きかけの本文、どれからでも書けます。入力した部分は活かして整え、空の部分を AI が補います。生成はバックグラウンドで続くので、ページを離れても大丈夫です（戻ると反映されます）。
        </p>
        {jobs.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-cyan-400/20 bg-cyan-500/[0.06] p-2 text-xs text-cyan-100">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {JOB_LABEL[j.kind]}
                {j.kind === "render" && j.target !== "all" ? `（${Number(j.target) + 1} 番目）` : ""}
                <span className="text-cyan-100/60">{j.progress ? `… ${j.progress}` : "… 順番待ち"}</span>
              </li>
            ))}
            <li className="text-[11px] text-cyan-100/50">バックグラウンドで生成中です。ページを離れても続きます。</li>
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!!busy || writing || !md.trim()} onClick={plan}>
              <Wand2 className="mr-1 inline h-3.5 w-3.5" />
              {busy === "plan" ? "考え中…" : "見出しごとの画像・図解を提案"}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => insertAtCursor("<!-- image: ここに入れたいイメージ -->")}>
              <ImageIcon className="mr-1 inline h-3.5 w-3.5" /> 画像の目印
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => insertAtCursor("<!-- infographic: 図にしたい内容 -->")}>
              <BarChart3 className="mr-1 inline h-3.5 w-3.5" /> 図解の目印
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="mr-1 inline h-3.5 w-3.5" /> 画像をアップロード
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={insertPaywall}>
              <Lock className="mr-1 inline h-3.5 w-3.5" /> 有料ラインをカーソル位置に
            </Button>
            <span className="flex-1" />
            <button className="text-xs text-white/50 hover:text-white" onClick={() => setShowPreview(!showPreview)}>
              {showPreview ? "編集に戻る" : "プレビュー"}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => uploadFile(e.target.files?.[0] ?? null)} />
          </div>
          {showPreview ? (
            <Preview md={md} title={title} eyecatch={eyecatch?.name ?? null} />
          ) : (
            <textarea
              ref={textRef}
              value={md}
              readOnly={writing}
              onChange={(e) => setMd(e.target.value)}
              rows={28}
              placeholder={"## 大見出し\n\n本文。大事なところは **太字** に。\n\n### 小見出し\n\n<!-- infographic: 3つの手順 -->\n\n<!-- paywall -->\n\n有料部分…"}
              className={`${inputCls} font-mono text-[13px] leading-6`}
            />
          )}
          <p className="text-[11px] text-white/40">
            ## 大見出し / ### 小見出し / **太字** / &lt;!-- paywall --&gt; ここから有料 / &lt;!-- image: … --&gt; イメージ画像 / &lt;!-- infographic: … --&gt; 図解。文字数 {[...md].length.toLocaleString()}
          </p>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">画像・図解（{list.length}）</h3>
              <Button disabled={!!busy || writing || !!jobFor("render") || !list.length} onClick={() => render()}>
                {jobFor("render", "all") ? "作成中…" : "すべて作る"}
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-white/40">目印はありません。作った画像は本文に ![説明](media:…) として入ります。</p>
            ) : (
              list.map((m) => (
                <div key={m.line} className="flex items-center gap-2 rounded-lg border border-white/[0.06] p-2 text-xs">
                  <Badge className={m.kind === "image" ? "bg-violet-500/15 text-violet-200" : "bg-cyan-500/15 text-cyan-200"}>{m.kind === "image" ? "画像" : "図解"}</Badge>
                  <span className="min-w-0 flex-1 truncate">{m.description || "（説明なし）"}</span>
                  <button className="text-cyan-300 disabled:text-white/30" disabled={!!busy || writing || !!jobFor("render")} onClick={() => render([m.index])}>
                    {jobFor("render", String(m.index)) ? "作成中…" : "作る"}
                  </button>
                </div>
              ))
            )}
            <p className="text-[11px] text-white/35">イメージ画像は画像生成 AI（設定 &gt; 画像生成）、図解はテンプレートで描きます（費用は設計の AI のみ）。作風はアバター &gt; 画像スタイル で設定します。</p>
          </Card>

          <Card className="space-y-2">
            <h3 className="text-sm font-semibold">見出し画像</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {eyecatch ? <img src={`/media/${eyecatch.name}`} alt="見出し画像" className="w-full rounded-lg" /> : <p className="text-xs text-white/40">未設定</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" disabled={!!busy || !!jobFor("eyecatch") || !title.trim()} onClick={makeEyecatch}>
                {jobFor("eyecatch") ? "生成中…" : "AI で作る（1280×670）"}
              </Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => eyeRef.current?.click()}>
                アップロード
              </Button>
              {eyecatch && (
                <Button variant="ghost" onClick={() => setEyecatch(null)}>
                  外す
                </Button>
              )}
              <input ref={eyeRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadFile(e.target.files?.[0] ?? null, true)} />
            </div>
          </Card>

          <Card className="space-y-3">
            <label className="block text-xs text-white/60">
              価格（円・空なら無料）
              <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="例: 500" className={`${inputCls} mt-1`} />
            </label>
            <div className="text-xs">
              有料ライン: {hasPaywall(md) ? <span className="text-emerald-300">あり</span> : <span className="text-white/40">なし</span>}
            </div>
            <label className="block text-xs text-white/60">
              タグ（カンマ区切り）
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ADHD, 習慣化" className={`${inputCls} mt-1`} />
            </label>
            {problems.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-200">
                {problems.map((p) => (
                  <li key={p}>・{p}</li>
                ))}
              </ul>
            )}
            <div className="space-y-1.5 rounded-lg border border-white/[0.06] p-2 text-xs text-white/70">
              <div className="text-[11px] text-white/45">入稿のしかた</div>
              {(
                [
                  ["draft", "下書きに保存（公開は note で）"],
                  ["publish", "すぐに公開"],
                  ["schedule", "日時を指定して公開（予約）"],
                ] as [SubmitMode, string][]
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="radio" name="note-submit-mode" checked={mode === v} onChange={() => setMode(v)} /> {label}
                </label>
              ))}
              {mode === "schedule" && <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className={`${inputCls} !py-1 text-xs`} />}
            </div>
            <Button disabled={!!busy || jobs.some((j) => j.kind !== "full")} onClick={submit}>
              {busy === "submit" ? "送信中…" : mode === "draft" ? "note の下書きに保存" : mode === "publish" ? "note で公開する" : "公開を予約する"}
            </Button>
            <p className="text-[11px] text-white/35">
              {mode === "draft"
                ? "本文・画像・見出し画像・有料ライン・価格・タグを下書きに入れます。公開は note の編集画面で行ってください。"
                : "下書きに保存したあと公開まで行います（非公式の仕組みのため、公開できなかったときは下書きとして残り、理由が表示されます）。"}
            </p>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Rocket className="h-4 w-4 text-cyan-300" /> 全自動で作る（テーマ → 執筆 → 画像・図解 → 見出し画像 → 入稿）
          </h3>
          <p className="text-[11px] text-white/40">上のエディタとは別に、テーマだけで 1 本仕上げて入稿します。書きかけの記事には影響しません。数分かかります（ページを離れても続きます）。</p>
          <label className="block text-xs text-white/60">
            テーマ・タイトル案
            <input value={autoTopic} onChange={(e) => setAutoTopic(e.target.value)} placeholder="例: ADHD でも続く朝の集中ルーティン" className={`${inputCls} mt-1`} />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-white/60">
              テンプレート
              <select value={autoTemplateId} onChange={(e) => setAutoTemplateId(e.target.value)} className={`${inputCls} mt-1 w-56`}>
                <option value="" className="bg-[#111]">
                  使わない（無料・画像あり・下書き）
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#111]">
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/60">
              入稿のしかた
              <select value={autoMode} onChange={(e) => setAutoMode(e.target.value as typeof autoMode)} className={`${inputCls} mt-1 !w-auto`}>
                <option value="template">テンプレートの設定どおり</option>
                <option value="draft">下書きに保存</option>
                <option value="publish">すぐに公開</option>
                <option value="schedule">日時を指定して公開</option>
              </select>
            </label>
            {autoMode === "schedule" && <input type="datetime-local" value={autoAt} onChange={(e) => setAutoAt(e.target.value)} className={`${inputCls} !w-auto !py-1.5 text-xs`} />}
          </div>
          {autoTemplateId && templates.find((t) => t.id === autoTemplateId) && <p className="text-[11px] text-white/45">{templateSummary(templates.find((t) => t.id === autoTemplateId)!)}</p>}
          <Button disabled={!!busy || !account || !autoTopic.trim() || !!jobFor("full")} onClick={runFull}>
            {jobFor("full") ? "作成中…" : "全自動で作る"}
          </Button>
        </Card>
        <ArticleTemplates
          templates={templates}
          onChanged={(msg) => {
            loadTemplates();
            setNotice({ kind: "ok", msg });
          }}
          onError={(msg) => setNotice({ kind: "error", msg })}
        />
      </div>
    </div>
  );
}
