"use client";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, relTime, Embedded, Shell } from "@/components/dashboard/shell";
import { api, Badge, Button, Card, Field, Notice } from "@/components/settings/ui";

interface Video {
  id: string;
  videoId: string;
  url: string;
  title: string;
  publishedAt: string | null;
  transcriptStatus: "pending" | "available" | "summarizing" | "summarized" | "unavailable";
  transcriptMethod: string | null;
  transcriptAt: string | null;
  summary: string | null;
  summaryEvidence: { points?: { point: string; quote: string }[]; model?: string };
  knowledgeIds: string[];
  error: string | null;
}
interface Channel {
  id: string;
  channelId: string;
  title: string | null;
  ownership: "own" | "other";
  avatarIds: string[];
  ownerAccountId: string | null;
  enabled: boolean;
  pollHours: number;
  lookbackDays: number;
  maxVideosPerRun: number;
  lastPolledAt: string | null;
  lastError: string | null;
  videos: Video[];
}
interface Data {
  channels: Channel[];
  avatars: { id: string; name: string }[];
  youtubeAccounts: { id: string; accountName: string }[];
  statusLabels: Record<string, string>;
}

const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  available: "bg-cyan-500/15 text-cyan-300",
  summarizing: "bg-cyan-500/15 text-cyan-300",
  summarized: "bg-emerald-500/15 text-emerald-300",
  unavailable: "bg-white/10 text-white/50",
};

const emptyForm = { channel: "", ownership: "other", avatarIds: [] as string[], ownerAccountId: "", pollHours: "24", lookbackDays: "30", maxVideosPerRun: "3" };

function YoutubeSectionInner() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [transcript, setTranscript] = useState<{ videoId: string; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => setData(await api<Data>("/api/youtube")), []);
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
    <Shell title="YouTube 学習" description="自分・他の人のチャンネルの新しい動画から学び、アバターのナレッジにする" wide>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      <p className="mb-4 text-[11px] text-white/40">
        新しい動画は公開フィードで検知します（API クォータを使いません）。本文（文字起こし）は、自分のチャンネルなら公式の字幕 API（動画の編集権限と YouTube アカウントの再接続が必要な場合があります）、他の人のチャンネルなら提供された文字起こしを登録して取得します。アクセス制限を回避する取得は行いません。本文が無い動画は「本文待ち／取得不可」のままで、説明文だけで要約したことにはしません。
      </p>
      {form ? (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold">チャンネルを登録</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field def={{ key: "ch", label: "チャンネル ID（UC…）または https://www.youtube.com/channel/UC… の URL", required: true }} value={form.channel} onChange={(v) => setForm({ ...form, channel: v })} />
            <Field
              def={{ key: "own", label: "種類", type: "select", options: [{ value: "other", label: "他の人のチャンネル" }, { value: "own", label: "自分のチャンネル" }] }}
              value={form.ownership}
              onChange={(v) => setForm({ ...form, ownership: v })}
            />
          </div>
          {form.ownership === "own" && (
            <Field
              def={{ key: "acc", label: "字幕の取得に使う YouTube アカウント（設定 > アカウントで接続済みのもの）", type: "select", options: [{ value: "", label: "使わない（文字起こしを手で登録）" }, ...(data?.youtubeAccounts ?? []).map((a) => ({ value: a.id, label: a.accountName }))] }}
              value={form.ownerAccountId}
              onChange={(v) => setForm({ ...form, ownerAccountId: v })}
            />
          )}
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
          <div className="grid gap-3 md:grid-cols-3">
            <Field def={{ key: "poll", label: "取得頻度（時間）" }} value={form.pollHours} onChange={(v) => setForm({ ...form, pollHours: v })} />
            <Field def={{ key: "look", label: "対象期間（公開から何日以内）" }} value={form.lookbackDays} onChange={(v) => setForm({ ...form, lookbackDays: v })} />
            <Field def={{ key: "max", label: "1回に要約する上限" }} value={form.maxVideosPerRun} onChange={(v) => setForm({ ...form, maxVideosPerRun: v })} />
          </div>
          <p className="text-[11px] text-white/40">要約に使うモデルは 設定 &gt; システム &gt; AI の「動画の要約」で選べます。</p>
          <div className="flex gap-2">
            <Button
              disabled={busy === "add" || !form.channel.trim() || !form.avatarIds.length}
              onClick={() =>
                run(
                  "add",
                  () =>
                    api("/api/youtube", {
                      method: "POST",
                      json: { ...form, ownerAccountId: form.ownerAccountId || null, pollHours: Number(form.pollHours), lookbackDays: Number(form.lookbackDays), maxVideosPerRun: Number(form.maxVideosPerRun) },
                    }).then(() => setForm(null)),
                  "登録しました"
                )
              }
            >
              登録
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              キャンセル
            </Button>
          </div>
        </Card>
      ) : (
        <Button className="mb-6" onClick={() => setForm({ ...emptyForm })} disabled={!data?.avatars.length}>
          + チャンネルを登録
        </Button>
      )}

      {transcript && (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold">文字起こしを登録して要約</h3>
          <p className="text-[11px] text-white/40">動画の提供者から受け取った文字起こしなど、利用してよい本文だけを貼り付けてください。要約は文字起こしの内容だけを根拠にします。</p>
          <Field def={{ key: "t", label: "文字起こし", type: "textarea" }} value={transcript.text} onChange={(v) => setTranscript({ ...transcript, text: v })} />
          <div className="flex gap-2">
            <Button
              disabled={busy === "tr" || transcript.text.trim().length < 50}
              onClick={() => run("tr", () => api(`/api/youtube/videos/${transcript.videoId}`, { method: "POST", json: { action: "transcript", transcript: transcript.text } }).then(() => setTranscript(null)), "登録して要約しました")}
            >
              {busy === "tr" ? "要約中…" : "登録して要約"}
            </Button>
            <Button variant="ghost" onClick={() => setTranscript(null)}>
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      {!data ? (
        <EmptyState>読み込み中…</EmptyState>
      ) : data.channels.length === 0 ? (
        <EmptyState>登録されたチャンネルはありません</EmptyState>
      ) : (
        <div className="space-y-4">
          {data.channels.map((ch) => (
            <Card key={ch.id} className={ch.enabled ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{ch.title ?? ch.channelId}</span>
                <Badge className="bg-white/5 text-white/50">{ch.ownership === "own" ? "自分のチャンネル" : "他の人のチャンネル"}</Badge>
                <span className="text-xs text-white/45">→ {ch.avatarIds.map(avatarName).join("、")}</span>
                <span className="flex-1" />
                <span className="text-[11px] text-white/35">
                  {ch.pollHours}時間ごと・{ch.lookbackDays}日以内・1回 {ch.maxVideosPerRun} 件・最終確認 {relTime(ch.lastPolledAt)}
                </span>
                <Button variant="ghost" disabled={busy === `poll:${ch.id}`} onClick={() => run(`poll:${ch.id}`, () => api(`/api/youtube/${ch.id}/poll`, { method: "POST" }), "新しい動画を確認しました")}>
                  今すぐ確認
                </Button>
                <Button variant="ghost" onClick={() => run(`en:${ch.id}`, () => api(`/api/youtube/${ch.id}`, { method: "PATCH", json: { enabled: !ch.enabled } }), ch.enabled ? "停止しました" : "再開しました")}>
                  {ch.enabled ? "停止" : "再開"}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => confirm("登録を解除しますか？（作成済みのナレッジは残ります）") && run(`del:${ch.id}`, () => api(`/api/youtube/${ch.id}`, { method: "DELETE" }), "解除しました")}
                >
                  解除
                </Button>
              </div>
              {ch.lastError && <p className="mt-1 text-xs text-red-300">直近のエラー: {ch.lastError}</p>}
              <div className="mt-3 space-y-2">
                {ch.videos.length === 0 ? (
                  <EmptyState>対象期間の動画はまだありません</EmptyState>
                ) : (
                  ch.videos.map((v) => (
                    <div key={v.id} className="rounded-lg border border-white/[0.06] p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={STATUS_CLS[v.transcriptStatus] ?? ""}>{data.statusLabels[v.transcriptStatus] ?? v.transcriptStatus}</Badge>
                        <a href={v.url} target="_blank" rel="noreferrer" className="underline">
                          {v.title}
                        </a>
                        <span className="text-white/35">{v.publishedAt ? new Date(v.publishedAt).toLocaleDateString("ja-JP") : ""}</span>
                        {v.transcriptMethod && <span className="text-white/35">取得: {v.transcriptMethod.startsWith("manual") ? "提供された文字起こし" : v.transcriptMethod.includes("asr") ? "字幕 API（自動生成）" : "字幕 API"}</span>}
                        <span className="flex-1" />
                        {v.transcriptStatus === "pending" && ch.ownership === "own" && ch.ownerAccountId && (
                          <Button variant="ghost" disabled={busy === `cap:${v.id}`} onClick={() => run(`cap:${v.id}`, () => api(`/api/youtube/videos/${v.id}`, { method: "POST", json: { action: "captions" } }), "字幕の取得を試しました")}>
                            字幕を取得
                          </Button>
                        )}
                        {(v.transcriptStatus === "pending" || v.transcriptStatus === "unavailable") && (
                          <Button variant="ghost" onClick={() => setTranscript({ videoId: v.id, text: "" })}>
                            文字起こしを登録
                          </Button>
                        )}
                        {v.transcriptStatus === "available" && (
                          <Button variant="ghost" disabled={busy === `sum:${v.id}`} onClick={() => run(`sum:${v.id}`, () => api(`/api/youtube/videos/${v.id}`, { method: "POST", json: { action: "summarize" } }), "要約しました")}>
                            要約
                          </Button>
                        )}
                        {v.transcriptStatus === "pending" && (
                          <Button variant="ghost" onClick={() => run(`un:${v.id}`, () => api(`/api/youtube/videos/${v.id}`, { method: "POST", json: { action: "unavailable", reason: "本文を入手できない" } }), "取得不可にしました")}>
                            取得不可にする
                          </Button>
                        )}
                      </div>
                      {v.error && <div className="mt-1 text-amber-300">{v.error}</div>}
                      {v.summary && (
                        <div className="mt-2 space-y-1">
                          <div className="text-white/70">{v.summary}</div>
                          {(v.summaryEvidence?.points ?? []).map((p, i) => (
                            <div key={i} className="text-white/45">
                              ・{p.point} <span className="text-white/30">— 根拠「{p.quote.slice(0, 80)}」</span>
                            </div>
                          ))}
                          <div className="text-[11px] text-white/30">ナレッジ {v.knowledgeIds.length} 件に保存{v.summaryEvidence?.model ? `・${v.summaryEvidence.model}` : ""}</div>
                        </div>
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

/** 別の画面のタブとして表示する */
export function YoutubeSection() {
  return (
    <Embedded>
      <YoutubeSectionInner />
    </Embedded>
  );
}
