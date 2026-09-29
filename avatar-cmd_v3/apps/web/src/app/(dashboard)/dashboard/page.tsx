"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { ComboChart, movingAverage } from "@/components/analytics/combo-chart";
import { AVATAR_STATUS as STATUS_LABEL, EmptyState, relTime, Shell, Stat, yen } from "@/components/dashboard/shell";
import { api, Badge, Card, Notice } from "@/components/settings/ui";
import { PlatformIcon } from "@/components/platform-icon";

interface Overview {
  kpis: {
    published7: number;
    publishedChange: number;
    successRate: number | null;
    accounts: number;
    scheduled: number;
    drafts: number;
    activeRules: number;
    revenue30: number;
    revenueChange: number;
  };
  daily: { date: string; count: number; failed: number; revenue: number }[];
  platforms: { platform: string; name: string; icon: string; count: number }[];
  avatars: {
    id: string;
    name: string;
    role: string;
    status: string;
    accounts: { platform: string; name: string; icon: string; accountName: string; ok: boolean }[];
    posts30: number;
    posts7: number;
  }[];
  alerts: { level: "error" | "warning" | "info"; title: string; description: string; href: string }[];
  status: { workerAlive: boolean; workerLastSeen: string | null; queued: number };
  nextRule: { name: string; nextRunAt: string } | null;
}


const ALERT_ICON = {
  error: <XCircle className="h-4 w-4 shrink-0 text-red-400" />,
  warning: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />,
  info: <Info className="h-4 w-4 shrink-0 text-cyan-400" />,
};

export default function DashboardPage() {
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = () => api<Overview>("/api/stats").then(setD).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const sign = (n: number) => (n > 0 ? `+${n}%` : `${n}%`);

  return (
    <Shell title="ダッシュボード" description="投稿・アカウント・自動化の状況" wide>
      {err && <Notice kind="error">{err}</Notice>}
      {!d ? (
        <p className="text-sm text-white/40">読み込み中…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="直近7日の投稿" value={d.kpis.published7} sub={`前週比 ${sign(d.kpis.publishedChange)}`} tone="text-cyan-300" />
            <Stat
              label="投稿成功率（7日）"
              value={d.kpis.successRate === null ? "—" : `${d.kpis.successRate}%`}
              tone={d.kpis.successRate !== null && d.kpis.successRate < 90 ? "text-amber-300" : "text-emerald-300"}
            />
            <Stat label="予約中 / 承認待ち" value={`${d.kpis.scheduled} / ${d.kpis.drafts}`} sub={`有効な自動化ルール ${d.kpis.activeRules}件`} />
            <Stat label="収益（30日）" value={yen(d.kpis.revenue30)} sub={`前30日比 ${sign(d.kpis.revenueChange)}`} tone="text-violet-300" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">日別の投稿・エラー・収益（30日）</h3>
                <span className="text-xs text-white/40">
                  投稿 {d.daily.reduce((s, x) => s + x.count, 0)}件 ・ 収益 {yen(d.daily.reduce((s, x) => s + x.revenue, 0))}
                </span>
              </div>
              <ComboChart
                data={(() => {
                  const avg = movingAverage(d.daily.map((x) => x.count), 7);
                  return d.daily.map((x, i) => ({ ...x, avg: avg[i] }));
                })()}
                xKey="date"
                xFormat={(v) => `${Number(v.slice(5, 7))}/${Number(v.slice(8))}`}
                labelFormat={(v) => `${Number(v.slice(5, 7))}/${Number(v.slice(8))}`}
                series={[
                  { key: "count", label: "投稿", color: "#3b82f6", kind: "bar" },
                  { key: "failed", label: "失敗", color: "#f87171", kind: "bar" },
                  { key: "avg", label: "投稿の7日平均", color: "#fbbf24", kind: "line", compare: true },
                  { key: "revenue", label: "収益", color: "#a78bfa", kind: "area", right: true },
                ]}
                formatLeft={(v) => `${v}件`}
                formatRight={yen}
                height={200}
              />
            </Card>
            <Card>
              <h3 className="mb-3 text-sm font-semibold">システム</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  {d.status.workerAlive ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                  worker {d.status.workerAlive ? "稼働中" : "停止"}
                  <span className="text-white/30">（最終応答 {relTime(d.status.workerLastSeen)}）</span>
                </div>
                <div className="text-white/60">送信待ちキュー: {d.status.queued}件</div>
                <div className="text-white/60">接続中アカウント: {d.kpis.accounts}件</div>
                <div className="text-white/60">
                  次の自動化: {d.nextRule ? `${d.nextRule.name}（${new Date(d.nextRule.nextRunAt).toLocaleString("ja-JP")}）` : "なし"}
                </div>
              </div>
              <h3 className="mb-2 mt-5 text-sm font-semibold">プラットフォーム別（30日）</h3>
              {d.platforms.length === 0 ? (
                <p className="text-xs text-white/40">まだ投稿はありません</p>
              ) : (
                <div className="space-y-1.5">
                  {d.platforms.map((p) => (
                    <div key={p.platform} className="flex items-center justify-between text-xs">
                      <span>
                        <PlatformIcon platform={p.platform} /> {p.name}
                      </span>
                      <span className="text-white/60">{p.count}件</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card>
            <h3 className="mb-3 text-sm font-semibold">対応が必要なこと</h3>
            {d.alerts.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> 問題はありません
              </p>
            ) : (
              <div className="space-y-2">
                {d.alerts.map((a, i) => (
                  <Link key={i} href={a.href} className="flex gap-3 rounded-lg border border-white/[0.06] p-3 no-underline hover:bg-white/[0.03]">
                    {ALERT_ICON[a.level]}
                    <div>
                      <div className="text-sm text-white">{a.title}</div>
                      <div className="mt-0.5 break-all text-xs text-white/50">{a.description}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">アバター</h3>
              <Link href="/avatars" className="text-xs text-cyan-300">
                管理 →
              </Link>
            </div>
            {d.avatars.length === 0 ? (
              <EmptyState>アバターがありません</EmptyState>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {d.avatars.map((a) => (
                  <Card key={a.id}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/20 font-bold text-violet-300">{a.name[0]}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">{a.name}</span>
                          <Badge className={STATUS_LABEL[a.status]?.cls ?? ""}>{STATUS_LABEL[a.status]?.label ?? a.status}</Badge>
                        </div>
                        <div className="truncate text-xs text-white/40">{a.role}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-4 text-xs text-white/60">
                      <span>7日: {a.posts7}件</span>
                      <span>30日: {a.posts30}件</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {a.accounts.length === 0 ? (
                        <Link href="/settings?tab=accounts" className="text-xs text-cyan-300">
                          アカウントを接続 →
                        </Link>
                      ) : (
                        a.accounts.map((x, i) => (
                          <Badge key={i} className={x.ok ? "bg-white/5 text-white/60" : "bg-red-500/15 text-red-300"}>
                            <PlatformIcon platform={x.platform} /> {x.accountName}
                          </Badge>
                        ))
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
