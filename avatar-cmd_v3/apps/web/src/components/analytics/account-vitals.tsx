"use client";
// アカウント分析（バイタルチェック）: アカウントごとの投稿・エラー・収益・フォロワーを月単位で表示する
// 収益分析ページ（全アカウント）とアバター管理ページ（そのアバターのアカウント）で共通
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, relTime, yen } from "@/components/dashboard/shell";
import { api, Badge, Button, Card, inputCls } from "@/components/settings/ui";
import { PlatformIcon } from "@/components/platform-icon";

type Level = "good" | "warning" | "error" | "inactive";
export interface AccountVital {
  id: string;
  avatarId: string;
  avatarName: string;
  platform: string;
  platformName: string;
  accountName: string;
  profileUrl: string | null;
  isActive: boolean;
  lastError: string | null;
  vital: { level: Level; score: number; reasons: string[] };
  posts: number;
  failed: number;
  scheduled: number;
  drafts: number;
  successRate: number | null;
  revenue: number;
  prevRevenue: number;
  followers: number | null;
  followersDelta: number | null;
  followersUpdatedAt: string | null;
  followersError: string | null;
  followersAuto: boolean;
  views: number;
  engagements: number;
  engagementRate: number | null;
  daily: { date: string; posts: number; failed: number; revenue: number; followers: number | null }[];
  revenueTrend: { month: string; total: number }[];
  items: { name: string; total: number; quantity: number }[];
}
interface Vitals {
  month: string;
  prevMonth: string;
  nextMonth: string | null;
  currentMonth: boolean;
  totals: {
    accounts: number;
    posts: number;
    failed: number;
    revenue: number;
    prevRevenue: number;
    unassignedRevenue: number;
    followers: number;
    followersDelta: number;
    attention: number;
    dailyRevenue: { date: string; revenue: number }[];
    revenueTrend: { month: string; total: number }[];
  };
  accounts: AccountVital[];
}

const LEVEL: Record<Level, { label: string; color: string; cls: string }> = {
  good: { label: "良好", color: "#34d399", cls: "bg-emerald-500/15 text-emerald-300" },
  warning: { label: "注意", color: "#fbbf24", cls: "bg-amber-500/15 text-amber-300" },
  error: { label: "要対応", color: "#f87171", cls: "bg-red-500/15 text-red-300" },
  inactive: { label: "停止中", color: "#6b7280", cls: "bg-white/10 text-white/50" },
};

const monthLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const shortMonth = (m: string) => `${Number(m.slice(5))}月`;
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("ja-JP"));
const signed = (n: number | null | undefined) => (n === null || n === undefined ? "" : `${n > 0 ? "+" : ""}${n.toLocaleString("ja-JP")}`);
const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));
const tooltipStyle = { contentStyle: { background: "#111318", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "rgba(255,255,255,0.6)" } };
const axis = { stroke: "rgba(255,255,255,0.3)", fontSize: 10, tickLine: false, axisLine: false } as const;

/** 前月・翌月に移動するページャー */
export function MonthPager({ month, prev, next, onChange }: { month: string; prev: string; next: string | null; onChange: (m: string | null) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(prev)} className="rounded-lg border border-white/10 p-1.5 text-white/60 hover:bg-white/[0.06] hover:text-white" title={`${monthLabel(prev)}へ`}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[7.5rem] text-center text-sm font-semibold">{monthLabel(month)}</span>
      <button
        onClick={() => next && onChange(next)}
        disabled={!next}
        className="rounded-lg border border-white/10 p-1.5 text-white/60 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
        title={next ? `${monthLabel(next)}へ` : "今月です"}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {next && (
        <button onClick={() => onChange(null)} className="ml-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/[0.06]">
          今月
        </button>
      )}
    </div>
  );
}

/** バイタルスコアのリングゲージ */
function ScoreRing({ score, level, size = 44 }: { score: number; level: Level; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`バイタルスコア ${score} / 100（${LEVEL[level].label}）`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ value: level === "inactive" ? 0 : score }]} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={8} fill={LEVEL[level].color} background={{ fill: "rgba(255,255,255,0.06)" }} isAnimationActive={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold" style={{ color: LEVEL[level].color }}>
        {level === "inactive" ? "—" : score}
      </span>
    </div>
  );
}

function Spark({ data, color = "#8b5cf6" }: { data: { v: number }[]; color?: string }) {
  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Tile({ label, value, sub, tone = "text-white" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="text-[11px] text-white/45">{label}</div>
      <div className={`mt-0.5 text-xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-white/40">{sub}</div>}
    </div>
  );
}

function Change({ now, prev }: { now: number; prev: number }) {
  const p = pct(now, prev);
  if (p === null) return <span className="text-white/35">前月 {yen(prev)}</span>;
  return (
    <span className={p >= 0 ? "text-emerald-300" : "text-red-300"}>
      前月比 {p >= 0 ? "+" : ""}
      {p}%
    </span>
  );
}

function AccountDetail({ a, days, onChanged }: { a: AccountVital; days: number; onChanged: () => void }) {
  const [followers, setFollowers] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const daily = a.daily.map((d) => ({ ...d, label: String(Number(d.date.slice(8))) }));
  const hasFollowers = daily.some((d) => d.followers !== null);

  async function updateFollowers(manual: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/accounts/${a.id}/followers`, { method: "POST", json: manual ? { followers } : {} });
      setFollowers("");
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
      {a.vital.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {a.vital.reasons.map((r) => (
            <Badge key={r} className={LEVEL[a.vital.level].cls}>
              {r}
            </Badge>
          ))}
        </div>
      )}
      {a.lastError && <p className="break-all text-xs text-red-300">直近のエラー: {a.lastError}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold text-white/70">日別の収益と投稿数</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" {...axis} interval={Math.max(0, Math.floor(days / 10) - 1)} />
                <YAxis yAxisId="r" {...axis} width={48} tickFormatter={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <YAxis yAxisId="p" orientation="right" {...axis} width={24} allowDecimals={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number, k: string) => (k === "収益" ? yen(v) : `${v}件`)} labelFormatter={(l) => `${l}日`} />
                <Bar yAxisId="r" dataKey="revenue" name="収益" fill="#8b5cf6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="p" dataKey="posts" name="投稿" stroke="#22d3ee" strokeWidth={2} dot={false} type="linear" isAnimationActive={false} />
                <Line yAxisId="p" dataKey="failed" name="失敗" stroke="#f87171" strokeWidth={1.5} dot={false} type="linear" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold text-white/70">収益の推移（6か月）</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.revenueTrend.map((t) => ({ ...t, label: shortMonth(t.month) }))} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} width={48} tickFormatter={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => yen(v)} />
                <Bar dataKey="total" name="収益" fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold text-white/70">フォロワー数の推移</h4>
          {hasFollowers ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval={Math.max(0, Math.floor(days / 10) - 1)} />
                  <YAxis {...axis} width={48} domain={["dataMin - 5", "dataMax + 5"]} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => `${v.toLocaleString("ja-JP")}人`} labelFormatter={(l) => `${l}日`} />
                  <Line dataKey="followers" name="フォロワー" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} connectNulls type="monotone" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState>この月のフォロワー数の記録がありません</EmptyState>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {a.followersAuto && (
              <Button variant="ghost" disabled={busy} onClick={() => updateFollowers(false)}>
                <RefreshCw className={`inline h-3 w-3 ${busy ? "animate-spin" : ""}`} /> API から取得
              </Button>
            )}
            <input value={followers} onChange={(e) => setFollowers(e.target.value.replace(/[^\d]/g, ""))} placeholder="フォロワー数を入力" className={`${inputCls} !w-36 !py-1.5`} />
            <Button variant="ghost" disabled={busy || !followers} onClick={() => updateFollowers(true)}>
              記録
            </Button>
            <span className="text-white/35">{a.followersUpdatedAt ? `最終更新 ${relTime(a.followersUpdatedAt)}` : a.followersAuto ? "毎日自動取得" : "自動取得に非対応（手入力）"}</span>
          </div>
          {(msg || a.followersError) && <p className="mt-1 break-all text-[11px] text-amber-300">{msg ?? `取得できませんでした: ${a.followersError}`}</p>}
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold text-white/70">この月の売上（アイテム別）</h4>
          {a.items.length === 0 ? (
            <EmptyState>このアカウントに紐付いた収益はまだありません</EmptyState>
          ) : (
            <div className="space-y-2">
              {a.items.map((it) => (
                <div key={it.name}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="truncate">{it.name}</span>
                    <span className="shrink-0 text-white/70">
                      {yen(it.total)} <span className="text-white/35">× {it.quantity}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-white/[0.06]">
                    <div className="h-1 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500" style={{ width: `${(it.total / Math.max(1, a.items[0].total)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-white/40">表示回数</div>
              <div className="text-sm font-semibold">{num(a.views)}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-white/40">反応</div>
              <div className="text-sm font-semibold">{num(a.engagements)}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-white/40">平均反応率</div>
              <div className="text-sm font-semibold">{a.engagementRate === null ? "—" : `${(a.engagementRate * 100).toFixed(1)}%`}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * avatarId を渡すとそのアバターのアカウントだけ。showOverview で全体の集計グラフも表示する。
 * reloadKey を変えると再読み込みする（収益を記録した後など）。
 */
export function AccountVitals({ avatarId, showOverview = true, reloadKey = 0 }: { avatarId?: string; showOverview?: boolean; reloadKey?: number }) {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Vitals | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (month) q.set("month", month);
      if (avatarId) q.set("avatarId", avatarId);
      setData(await api<Vitals>(`/api/analytics/accounts?${q}`));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month, avatarId]);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (err) return <p className="text-xs text-red-300">{err}</p>;
  if (!data) return <p className="text-xs text-white/40">読み込み中…</p>;
  const t = data.totals;
  const days = data.totals.dailyRevenue.length;

  return (
    <div className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <MonthPager month={data.month} prev={data.prevMonth} next={data.nextMonth} onChange={setMonth} />
        <span className="flex-1" />
        {t.attention > 0 && <Badge className="bg-amber-500/15 text-amber-300">要確認 {t.attention} アカウント</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label={`${shortMonth(data.month)}の収益`} value={yen(t.revenue)} tone="text-violet-300" sub={<Change now={t.revenue} prev={t.prevRevenue} />} />
        <Tile label="投稿" value={`${t.posts}件`} tone="text-cyan-300" sub={`${t.accounts} アカウント`} />
        <Tile label="投稿エラー" value={`${t.failed}件`} tone={t.failed ? "text-red-300" : "text-white"} sub={t.posts + t.failed ? `成功率 ${Math.round((t.posts / (t.posts + t.failed)) * 100)}%` : "—"} />
        <Tile label="フォロワー合計" value={num(t.followers)} tone="text-emerald-300" sub={t.followersDelta ? `この月 ${signed(t.followersDelta)}` : "増減の記録なし"} />
        <Tile label="アカウント未指定の収益" value={yen(t.unassignedRevenue)} sub="記録時にアカウントを選ぶと振り分けられます" />
      </div>

      {showOverview && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold">日別の収益（{monthLabel(data.month)}）</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={t.dailyRevenue.map((d) => ({ ...d, label: String(Number(d.date.slice(8))) }))} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval={Math.max(0, Math.floor(days / 10) - 1)} />
                  <YAxis {...axis} width={48} tickFormatter={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => yen(v)} labelFormatter={(l) => `${l}日`} />
                  <Bar dataKey="revenue" name="収益" fill="#8b5cf6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <h3 className="mb-2 text-sm font-semibold">6か月の推移</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={t.revenueTrend.map((m) => ({ ...m, label: shortMonth(m.month) }))} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" {...axis} />
                  <YAxis {...axis} width={48} tickFormatter={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => yen(v)} />
                  <Bar dataKey="total" name="収益" fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {data.accounts.length === 0 ? (
        <EmptyState>接続されたアカウントがありません</EmptyState>
      ) : (
        <div className="space-y-2">
          {data.accounts.map((a) => {
            const isOpen = open === a.id;
            return (
              <Card key={a.id} className={`!p-4 ${a.isActive ? "" : "opacity-60"}`}>
                <button onClick={() => setOpen(isOpen ? null : a.id)} className="flex w-full flex-wrap items-center gap-4 text-left">
                  <ScoreRing score={a.vital.score} level={a.vital.level} />
                  <div className="min-w-[10rem] flex-1">
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={a.platform} />
                      <span className="truncate font-semibold">{a.accountName}</span>
                      <Badge className={LEVEL[a.vital.level].cls}>{LEVEL[a.vital.level].label}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-white/40">
                      {a.platformName}
                      {!avatarId && ` ・ ${a.avatarName}`}
                      {a.vital.reasons[0] && ` ・ ${a.vital.reasons[0]}`}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-right text-xs">
                    <div>
                      <div className="text-white/40">投稿</div>
                      <div className="text-sm font-semibold">{a.posts}</div>
                    </div>
                    <div>
                      <div className="text-white/40">エラー</div>
                      <div className={`text-sm font-semibold ${a.failed ? "text-red-300" : ""}`}>{a.failed}</div>
                    </div>
                    <div>
                      <div className="text-white/40">収益</div>
                      <div className="text-sm font-semibold text-violet-200">{yen(a.revenue)}</div>
                      {(a.revenue > 0 || a.prevRevenue > 0) && (
                        <div className="text-[10px]">
                          <Change now={a.revenue} prev={a.prevRevenue} />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-white/40">フォロワー</div>
                      <div className="text-sm font-semibold">{num(a.followers)}</div>
                      {a.followersDelta !== null && a.followersDelta !== 0 && (
                        <div className={`text-[10px] ${a.followersDelta > 0 ? "text-emerald-300" : "text-red-300"}`}>{signed(a.followersDelta)}</div>
                      )}
                    </div>
                  </div>
                  <div className="hidden md:block">
                    <Spark data={a.daily.map((d) => ({ v: d.revenue }))} />
                  </div>
                  <ChevronDown className={`h-4 w-4 text-white/40 transition ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {a.profileUrl && isOpen && (
                  <a href={a.profileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-cyan-300">
                    プロフィールを開く <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {isOpen && <AccountDetail a={a} days={days} onChanged={load} />}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
