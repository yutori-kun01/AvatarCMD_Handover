"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { MetricChart, Sparkline } from "@/components/analytics/metric-chart";
import { AVATAR_STATUS as STATUS_LABEL, EmptyState, relTime, Shell } from "@/components/dashboard/shell";
import { ActivitySection } from "@/components/sections/activity-section";
import { api, Badge, Card, Notice } from "@/components/settings/ui";
import { AvatarIcon } from "@/components/avatar-icon";
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
  };
  platforms: { platform: string; name: string; icon: string; count: number }[];
  avatars: {
    id: string;
    name: string;
    role: string;
    status: string;
    imageUrl: string | null;
    xApi: { yen: number; capYen: number; level: string } | null;
    followers: number | null;
    followersDelta30: number | null;
    followerSpark: (number | null)[];
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

function DashboardInner() {
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = () => api<Overview>("/api/stats").then(setD).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Shell title="ダッシュボード" description="収益・フォロワー・閲覧数・反応率・投稿の推移と、対応が必要なこと" wide>
      {err && <Notice kind="error">{err}</Notice>}
      <div className="space-y-6">
        {/* 指標タブ（数字カードを押すとその指標のグラフ） */}
        <MetricChart syncUrl height={240} />

        {!d ? (
          <p className="text-sm text-white/40">読み込み中…</p>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
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
              <Card>
                <h3 className="mb-3 text-sm font-semibold">運用の状況</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    {d.status.workerAlive ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                    worker {d.status.workerAlive ? "稼働中" : "停止"}
                    <span className="text-white/30">（最終応答 {relTime(d.status.workerLastSeen)}）</span>
                  </div>
                  <div className="text-white/60">
                    直近7日の投稿 {d.kpis.published7}件（前週比 {d.kpis.publishedChange > 0 ? "+" : ""}
                    {d.kpis.publishedChange}%）・成功率 {d.kpis.successRate === null ? "—" : `${d.kpis.successRate}%`}
                  </div>
                  <div className="text-white/60">
                    予約中 {d.kpis.scheduled}件 ・ 承認待ち {d.kpis.drafts}件 ・ 送信待ち {d.status.queued}件
                  </div>
                  <div className="text-white/60">
                    接続アカウント {d.kpis.accounts}件 ・ 有効な自動化 {d.kpis.activeRules}件
                  </div>
                  <div className="text-white/60">次の自動化: {d.nextRule ? `${d.nextRule.name}（${new Date(d.nextRule.nextRunAt).toLocaleString("ja-JP")}）` : "なし"}</div>
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

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">アバター</h3>
                <Link href="/avatars" className="text-xs text-cyan-300">
                  分析・管理 →
                </Link>
              </div>
              {d.avatars.length === 0 ? (
                <EmptyState>アバターがありません</EmptyState>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {d.avatars.map((a) => (
                    <Link key={a.id} href={`/avatars?id=${a.id}`} className="block rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 no-underline transition hover:bg-white/[0.05]">
                      <div className="flex items-center gap-3">
                        <AvatarIcon name={a.name} url={a.imageUrl} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold text-white">{a.name}</span>
                            <Badge className={STATUS_LABEL[a.status]?.cls ?? ""}>{STATUS_LABEL[a.status]?.label ?? a.status}</Badge>
                          </div>
                          <div className="truncate text-xs text-white/40">{a.role === "sns_marketer" ? "" : a.role}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div className="text-xs text-white/60">
                          <div>
                            フォロワー {a.followers === null ? "—" : `${a.followers.toLocaleString("ja-JP")}人`}
                            {a.followersDelta30 !== null && (
                              <span className={a.followersDelta30 >= 0 ? "ml-1 text-emerald-300" : "ml-1 text-red-300"}>
                                （30日 {a.followersDelta30 > 0 ? "+" : ""}
                                {a.followersDelta30}）
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5">
                            投稿 7日 {a.posts7}件 ・ 30日 {a.posts30}件
                          </div>
                        </div>
                        <Sparkline values={a.followerSpark} />
                      </div>
                      {a.xApi && (
                        <div className="mt-3" title="X API の今月の費用 / 上限（アバター > X API）">
                          <div className="flex justify-between text-[11px] text-white/50">
                            <span>X API {a.xApi.level === "stopped" ? "（引用探索を停止）" : a.xApi.level === "reduced" ? "（縮小中）" : ""}</span>
                            <span className="tabular-nums">
                              ¥{a.xApi.yen.toLocaleString()} / ¥{a.xApi.capYen.toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className={`h-full rounded-full ${a.xApi.level === "stopped" ? "bg-red-400" : a.xApi.level === "reduced" ? "bg-amber-400" : "bg-cyan-400"}`}
                              style={{ width: `${a.xApi.capYen ? Math.min(100, (a.xApi.yen / a.xApi.capYen) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {a.accounts.length === 0 ? (
                          <span className="text-xs text-cyan-300">アカウント未接続</span>
                        ) : (
                          a.accounts.map((x, i) => (
                            <Badge key={i} className={x.ok ? "bg-white/5 text-white/60" : "bg-red-500/15 text-red-300"}>
                              <PlatformIcon platform={x.platform} /> {x.accountName}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div id="activity">
          <h3 className="mb-3 text-sm font-semibold">アクティビティ</h3>
          <ActivitySection limit={100} />
        </div>
      </div>
    </Shell>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardInner />
    </Suspense>
  );
}
