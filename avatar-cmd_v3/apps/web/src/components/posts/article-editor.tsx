"use client";
// note 記事エディタ: 本文（AI 下書き）→ 見出しごとの画像・図解の目印 → 生成 → 見出し画像・価格・有料ライン → note の下書きへ
// ・本文は Markdown のまま編集できる。目印は <!-- image: … --> / <!-- infographic: … -->、有料ラインは <!-- paywall -->
// ・作った画像は ![説明](media:{name}) として本文に入り、投稿時に添付される（note には自動でアップロード）
// ・公開ボタンだけは note の編集画面で本人が押す
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ImageIcon, ImagePlus, Lock, Sparkles, Wand2 } from "lucide-react";
import { api, Badge, Button, Card, inputCls, Notice, type AccountInfo } from "@/components/settings/ui";

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
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const eyeRef = useRef<HTMLInputElement>(null);

  const account = notes.find((a) => a.id === accountId) ?? notes[0];
  const avatarId = account?.avatarId;
  const list = useMemo(() => markers(md), [md]);

  // 書きかけは、この端末のブラウザにだけ保存する（失っても困らない補助）
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
      if (d) {
        setTitle(d.title ?? "");
        setMd(d.md ?? "");
        setPrice(d.price ?? "");
        setTags(d.tags ?? "");
        setEyecatch(d.eyecatch ?? null);
        setMedia(d.media ?? {});
      }
    } catch {
      /* 読めなければ空から */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, md, price, tags, eyecatch, media }));
      } catch {
        /* 保存できない環境では何もしない */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [title, md, price, tags, eyecatch, media]);

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

  async function generate() {
    const r = await run("generate", () => api<{ text: string }>("/api/articles/generate", { method: "POST", json: { avatarId, topic, paid } }));
    if (!r) return;
    // 先頭の「# タイトル」はタイトル欄へ
    const m = /^\s*#\s+(.+)\n/.exec(r.text);
    if (m && !/^##/.test(r.text.trim())) {
      setTitle(m[1].trim());
      setMd(r.text.slice(m[0].length).trim());
    } else setMd(r.text);
    if (!title && !m) setTitle(topic);
  }

  async function plan() {
    const r = await run("plan", () => api<{ markdown: string; plan: unknown[] }>("/api/articles/plan", { method: "POST", json: { markdown: md } }));
    if (r) {
      setMd(r.markdown);
      setNotice({ kind: "ok", msg: `${r.plan.length} か所に画像・図解の目印を入れました。内容を直してから「作る」を押してください` });
    }
  }

  async function render(only?: number[]) {
    const r = await run(only ? `render-${only[0]}` : "render-all", () =>
      api<{ markdown: string; media: MediaRef[]; results: { kind: string; description: string; error?: string; issues?: string[] }[] }>("/api/articles/render", { method: "POST", json: { avatarId, markdown: md, only } })
    );
    if (!r) return;
    setMd(r.markdown);
    setMedia((cur) => ({ ...cur, ...Object.fromEntries(r.media.map((m) => [m.name, m])) }));
    const errors = r.results.filter((x) => x.error);
    setNotice(errors.length ? { kind: "error", msg: `${r.media.length} 件作成、${errors.length} 件失敗: ${errors.map((e) => `${e.description}（${e.error}）`).join(" / ")}` } : { kind: "ok", msg: `${r.media.length} 件の画像・図解を作りました` });
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

  async function makeEyecatch() {
    const r = await run("eyecatch", () => api<{ media: MediaRef }>("/api/articles/eyecatch", { method: "POST", json: { avatarId, title, summary: md.slice(0, 400) } }));
    if (r) setEyecatch(r.media);
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
    return out;
  }

  async function submit() {
    const issues = check().filter((x) => !x.startsWith("まだ作っていない"));
    const warn = check().filter((x) => x.startsWith("まだ作っていない"));
    setProblems([...issues, ...warn]);
    if (issues.length) return;
    if (warn.length && !confirm(`${warn[0]}\nこのまま保存しますか？`)) return;
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
          options: { note: { title: title.trim(), price: price.replace(/[,，¥円\s]/g, ""), eyecatch: eyecatch?.name ?? "" } },
        },
      })
    );
    if (ok !== undefined) {
      setNotice({ kind: "ok", msg: "note への下書き保存を予約しました。1 分ほどで「SNS 投稿」の一覧に編集画面のリンクが出ます（公開は note の編集画面で）" });
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
          <label className="min-w-[260px] flex-1 text-xs text-white/60">
            テーマ（AI で書く場合）
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例: ADHD でも続く朝の集中ルーティン" className={`${inputCls} mt-1`} />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-white/60">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> 有料記事
          </label>
          <Button disabled={!!busy || !topic.trim()} onClick={generate}>
            <Sparkles className="mr-1 inline h-3.5 w-3.5" />
            {busy === "generate" ? "執筆中…（1〜2 分）" : "AI で書く"}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="記事タイトル" className={`${inputCls} text-base font-semibold`} />
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!!busy || !md.trim()} onClick={plan}>
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
              <Button disabled={!!busy || !list.length} onClick={() => render()}>
                {busy === "render-all" ? "作成中…" : "すべて作る"}
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-white/40">目印はありません。作った画像は本文に ![説明](media:…) として入ります。</p>
            ) : (
              list.map((m) => (
                <div key={m.line} className="flex items-center gap-2 rounded-lg border border-white/[0.06] p-2 text-xs">
                  <Badge className={m.kind === "image" ? "bg-violet-500/15 text-violet-200" : "bg-cyan-500/15 text-cyan-200"}>{m.kind === "image" ? "画像" : "図解"}</Badge>
                  <span className="min-w-0 flex-1 truncate">{m.description || "（説明なし）"}</span>
                  <button className="text-cyan-300 disabled:text-white/30" disabled={!!busy} onClick={() => render([m.index])}>
                    {busy === `render-${m.index}` ? "…" : "作る"}
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
              <Button variant="ghost" disabled={!!busy || !title.trim()} onClick={makeEyecatch}>
                {busy === "eyecatch" ? "生成中…" : "AI で作る"}
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
            <Button disabled={!!busy} onClick={submit}>
              {busy === "submit" ? "送信中…" : "note の下書きに保存"}
            </Button>
            <p className="text-[11px] text-white/35">本文・画像・見出し画像・有料ライン・価格・タグを下書きに入れます。公開は note の編集画面で行ってください。</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
