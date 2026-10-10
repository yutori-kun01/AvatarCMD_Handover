"use client";
// note 記事カレンダー: 作成予定・公開予定・保留中（承認待ち）・公開済みを日付ごとに表示し、その場で承認・日時変更・取り消しができる
import { useCallback, useEffect, useState } from "react";
import { api, Badge, Button, Card, inputCls } from "@/components/settings/ui";

interface Item {
  kind: "creation" | "held" | "scheduled" | "published";
  at: string;
  title: string;
  contentId?: string;
  ruleName?: string;
  accountName?: string;
  mode?: "publish" | "draft";
  price?: string;
  heldReason?: string;
  preview?: string;
  postUrl?: string | null;
  timing?: string;
}

const KIND: Record<Item["kind"], { label: string; cls: string }> = {
  creation: { label: "作成予定", cls: "bg-white/10 text-white/60" },
  held: { label: "保留中（承認待ち）", cls: "bg-amber-500/15 text-amber-300" },
  scheduled: { label: "公開予定", cls: "bg-cyan-500/15 text-cyan-300" },
  published: { label: "入稿済み", cls: "bg-emerald-500/15 text-emerald-300" },
};

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
/** datetime-local の値（日本時間） */
const localValue = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16);
const fromLocal = (v: string) => new Date(`${v}:00+09:00`).toISOString();

export function ArticleCalendar({ onNotice }: { onNotice: (kind: "ok" | "error", msg: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [days, setDays] = useState(14);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<{ items: Item[] }>(`/api/articles/calendar?days=${days}`).then((d) => setItems(d.items)), [days]);
  useEffect(() => {
    load().catch((e) => onNotice("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(key);
    try {
      await fn();
      onNotice("ok", msg);
      await load();
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const groups = new Map<string, Item[]>();
  for (const it of items ?? []) groups.set(dayKey(it.at), [...(groups.get(dayKey(it.at)) ?? []), it]);
  const held = (items ?? []).filter((i) => i.kind === "held").length;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">記事カレンダー</h3>
        {held > 0 && <Badge className="bg-amber-500/15 text-amber-300">承認待ち {held} 件</Badge>}
        <span className="flex-1" />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} !w-auto py-1 text-xs`} aria-label="表示する期間">
          <option value={7}>1 週間</option>
          <option value={14}>2 週間</option>
          <option value={28}>4 週間</option>
        </select>
      </div>
      <p className="text-[11px] text-white/40">自動化ルールの作成予定・予約中の公開・保留中の記事・直近 7 日に入稿した記事。保留中の記事は内容を確かめて承認すると、予定の時刻（過ぎていれば今すぐ）に公開します。</p>
      {!items ? (
        <p className="text-xs text-white/40">読み込み中…</p>
      ) : !items.length ? (
        <p className="text-xs text-white/40">予定はありません。自動化ルールの「note 記事」や、テンプレートの「このテンプレートで自動化」から作れます。</p>
      ) : (
        <div className="space-y-3">
          {[...groups].map(([day, list]) => (
            <div key={day}>
              <div className="mb-1 text-[11px] font-semibold text-white/50">{day}</div>
              <div className="space-y-1.5">
                {list.map((it, i) => {
                  const key = it.contentId ?? `${it.at}-${i}`;
                  return (
                    <div key={key} className="rounded-lg border border-white/[0.06] p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-11 tabular-nums text-white/50">{time(it.at)}</span>
                        <Badge className={KIND[it.kind].cls}>{KIND[it.kind].label}</Badge>
                        <span className="min-w-0 flex-1 truncate font-medium">{it.title}</span>
                        {it.price && <span className="text-white/45">¥{it.price}</span>}
                        {it.kind !== "creation" && <span className="text-white/35">{it.mode === "publish" ? "公開" : "下書き保存"}</span>}
                        {it.ruleName && <span className="text-white/35">{it.ruleName}</span>}
                        {it.preview && (
                          <button className="text-cyan-300/80 hover:text-cyan-200" onClick={() => setOpen(open === key ? null : key)}>
                            {open === key ? "閉じる" : "プレビュー"}
                          </button>
                        )}
                        {it.postUrl && (
                          <a href={it.postUrl} target="_blank" rel="noreferrer" className="text-cyan-300/80 hover:text-cyan-200">
                            開く
                          </a>
                        )}
                      </div>
                      {it.kind === "creation" && it.timing && <div className="mt-1 pl-[3.25rem] text-[11px] text-white/35">公開: {it.timing}</div>}
                      {it.heldReason && <div className="mt-1 pl-[3.25rem] text-[11px] text-amber-300/80">{it.heldReason}</div>}
                      {open === key && it.preview && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-white/70">{it.preview}{it.preview.length >= 1200 ? "\n…" : ""}</pre>}
                      {it.contentId && it.kind === "held" && (
                        <div className="mt-2 flex flex-wrap gap-2 pl-[3.25rem]">
                          <Button disabled={busy === key} onClick={() => act(key, () => api(`/api/posts/${it.contentId}/approve`, { method: "POST", json: {} }), "承認しました（予定の時刻に公開します）")}>
                            承認して公開を予約
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy === key}
                            onClick={() => confirm(`「${it.title}」を削除しますか？`) && act(key, () => api(`/api/posts/${it.contentId}`, { method: "DELETE" }), "削除しました")}
                          >
                            削除
                          </Button>
                        </div>
                      )}
                      {it.contentId && it.kind === "scheduled" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[3.25rem]">
                          <input
                            type="datetime-local"
                            value={edit[key] ?? localValue(it.at)}
                            onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
                            className={`${inputCls} !w-auto py-1 text-xs`}
                            aria-label="公開の日時"
                          />
                          <Button
                            variant="ghost"
                            disabled={busy === key || !edit[key] || edit[key] === localValue(it.at)}
                            onClick={() => act(key, () => api(`/api/posts/${it.contentId}`, { method: "PATCH", json: { scheduledAt: fromLocal(edit[key]) } }), "公開の日時を変更しました")}
                          >
                            日時を変更
                          </Button>
                          <Button variant="ghost" disabled={busy === key} onClick={() => act(key, () => api(`/api/posts/${it.contentId}`, { method: "PATCH", json: { unschedule: true } }), "予約を取り消して下書きに戻しました")}>
                            予約を取り消す
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
