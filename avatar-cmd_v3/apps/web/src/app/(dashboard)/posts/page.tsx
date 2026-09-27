"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, ImagePlus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { api, Badge, Button, Card, Field, inputCls, Notice, type AccountInfo, type PlatformInfo } from "@/components/settings/ui";

interface MediaRef {
  name: string;
  mimeType: string;
  size: number;
  filename: string;
  alt?: string;
}

interface PostRow {
  id: string;
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
}

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "承認待ち", cls: "bg-amber-500/15 text-amber-300" },
  SCHEDULED: { label: "予約中", cls: "bg-cyan-500/15 text-cyan-300" },
  PUBLISHING: { label: "送信中", cls: "bg-violet-500/15 text-violet-300" },
  PUBLISHED: { label: "投稿済み", cls: "bg-emerald-500/15 text-emerald-300" },
  FAILED: { label: "失敗", cls: "bg-red-500/15 text-red-300" },
};

export default function PostsPage() {
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
        <Header title="投稿" description="SNSへの投稿・予約・送信状況" />
        <main className="flex-1 overflow-auto p-6">
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
                          {byId[a.platform]?.icon} {a.accountName}
                          <span className="ml-1 text-white/30">({a.avatarName})</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

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
                    {selectedPlatforms
                      .filter((p) => p.maxLength)
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
                <div className="grid gap-4 md:grid-cols-2">
                  <Field def={{ key: "link", label: "リンク（任意）", type: "url", placeholder: "https://" }} value={link} onChange={setLink} />
                  <Field def={{ key: "tags", label: "タグ（カンマ区切り）", placeholder: "AI, 副業" }} value={tags} onChange={setTags} />
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
        </main>
      </div>
    </div>
  );
}
