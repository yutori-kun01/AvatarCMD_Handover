"use client";
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Bars, EmptyState, Shell, Stat, yen } from "@/components/dashboard/shell";
import { api, Button, Card, Field, inputCls, Notice } from "@/components/settings/ui";

interface Report {
  total: number;
  byAvatar: { key: string; total: number }[];
  bySource: { key: string; total: number }[];
  byPlatform: { key: string; total: number }[];
  monthly: { month: string; total: number }[];
  entries: { id: string; avatarName: string; source: string; platform: string; amount: number; currency: string; description: string | null; earnedAt: string }[];
}

const SOURCES = [
  { value: "affiliate", label: "アフィリエイト" },
  { value: "paid_content", label: "有料コンテンツ" },
  { value: "sponsorship", label: "スポンサー・案件" },
  { value: "donation", label: "投げ銭・サポート" },
  { value: "ad", label: "広告収益" },
  { value: "subscription", label: "サブスク・メンバーシップ" },
  { value: "merchandise", label: "物販" },
  { value: "other", label: "その他" },
];
const sourceLabel = (s: string) => SOURCES.find((x) => x.value === s)?.label ?? s;

export default function RevenuePage() {
  const [r, setR] = useState<Report | null>(null);
  const [avatars, setAvatars] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ avatarId: "", source: "affiliate", platform: "", amount: "", description: "", earnedAt: today });

  const load = useCallback(async () => {
    const [rep, av] = await Promise.all([api<Report>("/api/revenue"), api<{ avatars: { id: string; name: string }[] }>("/api/avatars")]);
    setR(rep);
    setAvatars(av.avatars);
    setF((x) => ({ ...x, avatarId: x.avatarId || av.avatars[0]?.id || "" }));
  }, []);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", msg: e.message }));
  }, [load]);

  async function add() {
    try {
      await api("/api/revenue", { method: "POST", json: { ...f, earnedAt: new Date(`${f.earnedAt}T12:00:00+09:00`).toISOString() } });
      setF({ ...f, amount: "", description: "" });
      setNotice({ kind: "ok", msg: "記録しました" });
      load();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }
  async function remove(id: string) {
    if (!confirm("この記録を削除しますか？")) return;
    await api(`/api/revenue/${id}`, { method: "DELETE" }).catch((e) => setNotice({ kind: "error", msg: e.message }));
    load();
  }

  const List = ({ title, rows, label = (k: string) => k }: { title: string; rows: { key: string; total: number }[]; label?: (k: string) => string }) => (
    <Card>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-white/40">データなし</p>
      ) : (
        <div className="space-y-2">
          {rows.map((x) => (
            <div key={x.key}>
              <div className="flex justify-between text-xs">
                <span>{label(x.key)}</span>
                <span className="text-white/70">{yen(x.total)}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-white/[0.06]">
                <div className="h-1 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500" style={{ width: `${(x.total / Math.max(1, rows[0].total)) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <Shell title="収益分析" description="アバター・収益源・プラットフォーム別の収益" wide>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      {r && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="累計（記録分）" value={yen(r.total)} tone="text-violet-300" />
            <Stat label="今月" value={yen(r.monthly[r.monthly.length - 1]?.total ?? 0)} tone="text-cyan-300" />
            <Stat label="先月" value={yen(r.monthly[r.monthly.length - 2]?.total ?? 0)} />
          </div>

          <Card className="space-y-4">
            <h3 className="text-sm font-semibold">収益を記録</h3>
            <p className="text-xs text-white/45">各SNSの収益APIは提供範囲が限られるため、振込・管理画面の金額をここに記録します。</p>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">アバター</span>
                <select value={f.avatarId} onChange={(e) => setF({ ...f, avatarId: e.target.value })} className={inputCls}>
                  {avatars.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#111]">{a.name}</option>
                  ))}
                </select>
              </label>
              <Field def={{ key: "source", label: "収益源", type: "select", options: SOURCES }} value={f.source} onChange={(v) => setF({ ...f, source: v })} />
              <Field def={{ key: "platform", label: "プラットフォーム", placeholder: "note / YouTube / Amazon など" }} value={f.platform} onChange={(v) => setF({ ...f, platform: v })} />
              <Field def={{ key: "amount", label: "金額（円）", placeholder: "3000" }} value={f.amount} onChange={(v) => setF({ ...f, amount: v.replace(/[^\d.-]/g, "") })} />
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">日付</span>
                <input type="date" value={f.earnedAt} onChange={(e) => setF({ ...f, earnedAt: e.target.value })} className={inputCls} />
              </label>
              <Field def={{ key: "desc", label: "メモ", placeholder: "記事『…』の売上" }} value={f.description} onChange={(v) => setF({ ...f, description: v })} />
            </div>
            <Button onClick={add} disabled={!f.amount || !f.platform || !f.avatarId}>
              記録する
            </Button>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold">月別（6か月）</h3>
            <Bars data={r.monthly.map((m) => ({ label: m.month, value: m.total }))} format={yen} />
            <div className="mt-1 flex justify-between text-[10px] text-white/30">
              {r.monthly.map((m) => (
                <span key={m.month}>{m.month}</span>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <List title="アバター別" rows={r.byAvatar} />
            <List title="収益源別" rows={r.bySource} label={sourceLabel} />
            <List title="プラットフォーム別" rows={r.byPlatform} />
          </div>

          <Card>
            <h3 className="mb-3 text-sm font-semibold">記録一覧</h3>
            {r.entries.length === 0 ? (
              <EmptyState>まだ記録はありません</EmptyState>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {r.entries.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="w-24 text-xs text-white/40">{new Date(e.earnedAt).toLocaleDateString("ja-JP")}</span>
                    <span className="w-24 truncate">{e.avatarName}</span>
                    <span className="w-32 truncate text-xs text-white/60">{sourceLabel(e.source)} / {e.platform}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-white/40">{e.description}</span>
                    <span className="font-semibold">{yen(e.amount)}</span>
                    <button onClick={() => remove(e.id)} className="text-white/30 hover:text-red-300" title="削除">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
