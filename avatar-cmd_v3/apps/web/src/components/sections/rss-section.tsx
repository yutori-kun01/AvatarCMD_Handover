"use client";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, relTime, Embedded, Shell } from "@/components/dashboard/shell";
import { api, Badge, Button, Card, Field, Notice } from "@/components/settings/ui";

interface Article {
  id: string;
  url: string;
  title: string;
  publishedAt: string | null;
  excerpt: string | null;
  status: "pending" | "available" | "summarizing" | "summarized" | "unavailable";
  contentMethod: string | null;
  contentAt: string | null;
  summary: string | null;
  summaryEvidence: { points?: { point: string; quote: string }[]; model?: string };
  knowledgeIds: string[];
  attempts: number;
  error: string | null;
}
interface Feed {
  id: string;
  url: string;
  title: string | null;
  siteUrl: string | null;
  avatarIds: string[];
  enabled: boolean;
  pollHours: number;
  lookbackDays: number;
  maxItemsPerRun: number;
  fetchFullText: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  articles: Article[];
}
interface Data {
  feeds: Feed[];
  avatars: { id: string; name: string }[];
  statusLabels: Record<string, string>;
}

const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  available: "bg-cyan-500/15 text-cyan-300",
  summarizing: "bg-cyan-500/15 text-cyan-300",
  summarized: "bg-emerald-500/15 text-emerald-300",
  unavailable: "bg-white/10 text-white/50",
};

const METHOD_LABEL = (m: string) => (m === "feed" ? "フィードの全文" : m === "page" ? "記事ページから抽出" : m === "page_body" ? "記事ページ（全体）" : m.startsWith("manual") ? "登録された本文" : m);

const emptyForm = { url: "", avatarIds: [] as string[], pollHours: "6", lookbackDays: "7", maxItemsPerRun: "3", fetchFullText: "on" };

function RssSectionInner() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [content, setContent] = useState<{ articleId: string; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => setData(await api<Data>("/api/rss")), []);
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
      await load();
    } finally {
      setBusy("");
    }
  };

  const avatarName = (id: string) => data?.avatars.find((a) => a.id === id)?.name ?? "(削除済み)";

  return (
    <Shell title="RSS 学習" description="ブログ・ニュース・note などの新着記事から学び、アバターのナレッジにする" wide>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      <p className="mb-4 text-[11px] text-white/40">
        新着記事は RSS / Atom フィードで検知します。本文はフィードに全文があればそれを、抜粋しか無ければ記事ページから本文だけを取り出して使います（ナビ・広告・関連記事・note のスキ欄などは除きます）。会員限定などで本文が取れない記事は「本文待ち」のまま理由を表示し、見出しや抜粋だけで要約したことにはしません。
      </p>
      {form ? (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold">フィードを登録</h3>
          <Field
            def={{ key: "url", label: "フィードの URL、またはサイトの URL（例: https://note.com/ユーザー名 → 自動で /rss に。ブログのトップページならフィードを探します）", required: true }}
            value={form.url}
            onChange={(v) => setForm({ ...form, url: v })}
          />
          <div>
            <div className="mb-1 text-xs text-white/60">学んだ内容を入れるアバター</div>
            <div className="flex flex-wrap gap-2">
              {(data?.avatars ?? []).map((a) => {
                const on = form.avatarIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => setForm({ ...form, avatarIds: on ? form.avatarIds.filter((x) => x !== a.id) : [...form.avatarIds, a.id] })}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${on ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60"}`}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field def={{ key: "poll", label: "取得頻度（時間）" }} value={form.pollHours} onChange={(v) => setForm({ ...form, pollHours: v })} />
            <Field def={{ key: "look", label: "対象期間（公開から何日以内）" }} value={form.lookbackDays} onChange={(v) => setForm({ ...form, lookbackDays: v })} />
            <Field def={{ key: "max", label: "1回に要約する上限" }} value={form.maxItemsPerRun} onChange={(v) => setForm({ ...form, maxItemsPerRun: v })} />
            <Field
              def={{ key: "full", label: "記事ページから本文を取得", type: "select", options: [{ value: "on", label: "する（抜粋だけのフィード向け）" }, { value: "off", label: "しない（フィードの全文のみ）" }] }}
              value={form.fetchFullText}
              onChange={(v) => setForm({ ...form, fetchFullText: v })}
            />
          </div>
          <p className="text-[11px] text-white/40">要約に使うモデルは 設定 &gt; システム &gt; AI の「動画・記事の要約」で選べます。</p>
          <div className="flex gap-2">
            <Button
              disabled={busy === "add" || !form.url.trim() || !form.avatarIds.length}
              onClick={() =>
                run(
                  "add",
                  () =>
                    api("/api/rss", {
                      method: "POST",
                      json: { url: form.url, avatarIds: form.avatarIds, pollHours: Number(form.pollHours), lookbackDays: Number(form.lookbackDays), maxItemsPerRun: Number(form.maxItemsPerRun), fetchFullText: form.fetchFullText === "on" },
                    }).then(() => setForm(null)),
                  "登録しました"
                )
              }
            >
              {busy === "add" ? "フィードを確認中…" : "登録"}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              キャンセル
            </Button>
          </div>
        </Card>
      ) : (
        <Button className="mb-6" onClick={() => setForm({ ...emptyForm })} disabled={!data?.avatars.length}>
          + フィードを登録
        </Button>
      )}

      {content && (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold">本文を登録して要約</h3>
          <p className="text-[11px] text-white/40">購入済みの有料記事など、利用してよい本文だけを貼り付けてください。要約は本文の内容だけを根拠にします。</p>
          <Field def={{ key: "c", label: "本文", type: "textarea" }} value={content.text} onChange={(v) => setContent({ ...content, text: v })} />
          <div className="flex gap-2">
            <Button
              disabled={busy === "ct" || content.text.trim().length < 100}
              onClick={() => run("ct", () => api(`/api/rss/articles/${content.articleId}`, { method: "POST", json: { action: "content", content: content.text } }).then(() => setContent(null)), "登録して要約しました")}
            >
              {busy === "ct" ? "要約中…" : "登録して要約"}
            </Button>
            <Button variant="ghost" onClick={() => setContent(null)}>
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      {!data ? (
        <EmptyState>読み込み中…</EmptyState>
      ) : data.feeds.length === 0 ? (
        <EmptyState>登録されたフィードはありません</EmptyState>
      ) : (
        <div className="space-y-4">
          {data.feeds.map((f) => (
            <Card key={f.id} className={f.enabled ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-center gap-2">
                <a href={f.siteUrl ?? f.url} target="_blank" rel="noreferrer" className="font-semibold underline-offset-2 hover:underline">
                  {f.title ?? f.url}
                </a>
                {!f.fetchFullText && <Badge className="bg-white/5 text-white/50">フィードの全文のみ</Badge>}
                <span className="text-xs text-white/45">→ {f.avatarIds.map(avatarName).join("、")}</span>
                <span className="flex-1" />
                <span className="text-[11px] text-white/35">
                  {f.pollHours}時間ごと・{f.lookbackDays}日以内・1回 {f.maxItemsPerRun} 件・最終確認 {relTime(f.lastPolledAt)}
                </span>
                <Button variant="ghost" disabled={busy === `poll:${f.id}`} onClick={() => run(`poll:${f.id}`, () => api(`/api/rss/${f.id}/poll`, { method: "POST" }), "新しい記事を確認しました")}>
                  今すぐ確認
                </Button>
                <Button variant="ghost" onClick={() => run(`en:${f.id}`, () => api(`/api/rss/${f.id}`, { method: "PATCH", json: { enabled: !f.enabled } }), f.enabled ? "停止しました" : "再開しました")}>
                  {f.enabled ? "停止" : "再開"}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => confirm("登録を解除しますか？（作成済みのナレッジは残ります）") && run(`del:${f.id}`, () => api(`/api/rss/${f.id}`, { method: "DELETE" }), "解除しました")}
                >
                  解除
                </Button>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-white/30">{f.url}</div>
              {f.lastError && <p className="mt-1 text-xs text-red-300">直近のエラー: {f.lastError}</p>}
              <div className="mt-3 space-y-2">
                {f.articles.length === 0 ? (
                  <EmptyState>対象期間の記事はまだありません</EmptyState>
                ) : (
                  f.articles.map((a) => (
                    <div key={a.id} className="rounded-lg border border-white/[0.06] p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={STATUS_CLS[a.status] ?? ""}>{data.statusLabels[a.status] ?? a.status}</Badge>
                        <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                          {a.title}
                        </a>
                        <span className="text-white/35">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString("ja-JP") : ""}</span>
                        {a.contentMethod && <span className="text-white/35">取得: {METHOD_LABEL(a.contentMethod)}</span>}
                        <span className="flex-1" />
                        {a.status === "pending" && (
                          <Button variant="ghost" disabled={busy === `fe:${a.id}`} onClick={() => run(`fe:${a.id}`, () => api(`/api/rss/articles/${a.id}`, { method: "POST", json: { action: "fetch" } }), "本文の取得を試しました")}>
                            本文を取得
                          </Button>
                        )}
                        {(a.status === "pending" || a.status === "unavailable") && (
                          <Button variant="ghost" onClick={() => setContent({ articleId: a.id, text: "" })}>
                            本文を登録
                          </Button>
                        )}
                        {a.status === "available" && (
                          <Button variant="ghost" disabled={busy === `sum:${a.id}`} onClick={() => run(`sum:${a.id}`, () => api(`/api/rss/articles/${a.id}`, { method: "POST", json: { action: "summarize" } }), "要約しました")}>
                            要約
                          </Button>
                        )}
                        {a.status === "pending" && (
                          <Button variant="ghost" onClick={() => run(`un:${a.id}`, () => api(`/api/rss/articles/${a.id}`, { method: "POST", json: { action: "unavailable", reason: "本文を入手できない" } }), "取得不可にしました")}>
                            取得不可にする
                          </Button>
                        )}
                      </div>
                      {a.error && <div className="mt-1 text-amber-300">{a.error}</div>}
                      {a.summary ? (
                        <div className="mt-2 space-y-1">
                          <div className="text-white/70">{a.summary}</div>
                          {(a.summaryEvidence?.points ?? []).map((p, i) => (
                            <div key={i} className="text-white/45">
                              ・{p.point} <span className="text-white/30">— 根拠「{p.quote.slice(0, 80)}」</span>
                            </div>
                          ))}
                          <div className="text-[11px] text-white/30">ナレッジ {a.knowledgeIds.length} 件に保存{a.summaryEvidence?.model ? `・${a.summaryEvidence.model}` : ""}</div>
                        </div>
                      ) : (
                        a.excerpt && <div className="mt-1 line-clamp-2 text-white/35">{a.excerpt}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}

// v3.7 — ナレッジ・学習 > RSS 学習 タブに埋め込む（旧 /rss は /knowledge?tab=rss へリダイレクト）
export function RssSection() {
  return (
    <Embedded>
      <RssSectionInner />
    </Embedded>
  );
}
