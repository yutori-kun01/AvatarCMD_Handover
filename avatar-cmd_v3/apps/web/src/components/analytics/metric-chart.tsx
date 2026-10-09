"use client";
// 指標で切り替えるグラフ（収益・フォロワー・閲覧数・反応率・投稿）
// ・上の数字カードがタブを兼ねる（押すとその指標のグラフ）。期間は 7日 / 30日 / 90日
// ・指標ごとにグラフの形は固定（棒・折れ線の切り替えはしない）。1 つのグラフに軸は 1 本
// ・比較は前の同じ長さの期間（点線）
// ・scope: avatarId / accountId で絞り込み。無ければ全体
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/components/settings/ui";
import { yen } from "@/components/dashboard/shell";
import { CHART_COLORS as C, ComboChart, movingAverage, type Series } from "./combo-chart";

export type MetricKey = "revenue" | "followers" | "views" | "engagementRate" | "posts";
type Range = "7d" | "30d" | "90d";

interface Day {
  date: string;
  revenue: number;
  posts: number;
  failed: number;
  followers: number | null;
  followersDelta: number | null;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
  prevRevenue: number;
  prevViews: number | null;
  prevPosts: number;
  prevEngagementRate: number | null;
}
interface Totals {
  revenue: number;
  posts: number;
  failed: number;
  followers: number | null;
  followersDelta: number | null;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
}
export interface Timeseries {
  range: Range;
  days: string[];
  daily: Day[];
  totals: Totals;
  prevTotals: Totals;
  change: { revenue: number | null; posts: number | null; views: number | null; engagementRate: number | null; followersDelta: number | null };
}

const RANGES: { id: Range; label: string }[] = [
  { id: "7d", label: "7日" },
  { id: "30d", label: "30日" },
  { id: "90d", label: "90日" },
];
const METRICS: MetricKey[] = ["revenue", "followers", "views", "engagementRate", "posts"];

const num = (v: number) => Math.round(v).toLocaleString("ja-JP");
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const signed = (v: number) => `${v > 0 ? "+" : ""}${num(v)}`;
const dayLabel = (v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8))}`;

function Delta({ value, unit = "%" }: { value: number | null; unit?: string }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${up ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {unit === "pt" ? value.toFixed(2) : value}
      {unit}
    </span>
  );
}

/** 指標ごとの見出し・大きな数字・前期比 */
function card(key: MetricKey, t: Timeseries) {
  const x = t.totals;
  switch (key) {
    case "revenue":
      return { label: "収益", value: yen(x.revenue), delta: <Delta value={t.change.revenue} />, sub: `前期間 ${yen(t.prevTotals.revenue)}` };
    case "followers":
      return {
        label: "フォロワー増減",
        value: x.followersDelta === null ? "—" : signed(x.followersDelta),
        delta: t.change.followersDelta === null ? null : <Delta value={t.change.followersDelta} unit="人" />,
        sub: x.followers === null ? "記録なし" : `現在 ${num(x.followers)}人`,
      };
    case "views":
      return { label: "閲覧数", value: x.views === null ? "—" : num(x.views), delta: <Delta value={t.change.views} />, sub: x.engagements === null ? "記録なし" : `反応 ${num(x.engagements)}` };
    case "engagementRate":
      return { label: "反応率", value: pct(x.engagementRate), delta: <Delta value={t.change.engagementRate} unit="pt" />, sub: `前期間 ${pct(t.prevTotals.engagementRate)}` };
    case "posts":
      return {
        label: "投稿",
        value: `${num(x.posts)}件`,
        delta: <Delta value={t.change.posts} />,
        sub: x.failed ? `失敗 ${x.failed}件` : x.posts ? "失敗なし" : "—",
      };
  }
}

const HELP: Record<MetricKey, string> = {
  revenue: "記録した収益の日別合計。点線は前の期間の同じ日",
  followers: "フォロワーの前日比（アカウントごとの差の合計）。記録の無い日は前の値を引き継ぎ",
  views: "閲覧数（インプレッション・PV）。Threads は日別の公式値、X は投稿ごとの増分、note は累計 PV の差分",
  engagementRate: "反応数 ÷ 閲覧数（いいね・返信・リポスト・引用・シェア）",
  posts: "公開できた投稿と失敗の件数",
};

function chartFor(key: MetricKey, daily: Day[]): { data: Record<string, unknown>[]; series: Series[]; format: (v: number) => string; leftDomain?: [number | string, number | string] } {
  switch (key) {
    case "revenue":
      return {
        data: daily.map((d) => ({ date: d.date, revenue: d.revenue, prev: d.prevRevenue })),
        series: [
          { key: "revenue", label: "収益", color: C.brand, gradient: [C.brandFrom, C.brandTo], kind: "bar" },
          // 収益は日によって 0 が多いので、前期間は線ではなく薄い棒で比べる
          { key: "prev", label: "前の期間", color: C.muted, kind: "bar", compare: true },
        ],
        format: yen,
      };
    case "followers":
      return {
        data: daily.map((d) => ({ date: d.date, up: d.followersDelta !== null && d.followersDelta >= 0 ? d.followersDelta : null, down: d.followersDelta !== null && d.followersDelta < 0 ? d.followersDelta : null })),
        series: [
          { key: "up", label: "増加", color: C.blue, kind: "bar", stack: "delta" },
          { key: "down", label: "減少", color: C.red, kind: "bar", stack: "delta" },
        ],
        format: (v) => `${signed(v)}人`,
        leftDomain: ["auto", "auto"],
      };
    case "views": {
      const avg = movingAverage(daily.map((d) => d.views ?? 0), 7);
      return {
        data: daily.map((d, i) => ({ date: d.date, views: d.views, prev: d.prevViews, avg: d.views === null ? null : avg[i] })),
        series: [
          { key: "views", label: "閲覧数", color: C.cyan, kind: "area" },
          { key: "avg", label: "7日平均", color: C.amber, kind: "line", compare: true, hidden: daily.length <= 7 },
          { key: "prev", label: "前の期間", color: C.muted, kind: "line", compare: true, hidden: true },
        ],
        format: num,
      };
    }
    case "engagementRate":
      return {
        data: daily.map((d) => ({ date: d.date, rate: d.engagementRate === null ? null : Math.round(d.engagementRate * 10000) / 100, prev: d.prevEngagementRate === null ? null : Math.round(d.prevEngagementRate * 10000) / 100 })),
        series: [
          { key: "rate", label: "反応率", color: C.violet, kind: "line" },
          { key: "prev", label: "前の期間", color: C.muted, kind: "line", compare: true },
        ],
        format: (v) => `${v.toFixed(2)}%`,
      };
    case "posts": {
      const avg = movingAverage(daily.map((d) => d.posts), 7);
      return {
        data: daily.map((d, i) => ({ date: d.date, posts: d.posts, failed: d.failed, avg: avg[i] })),
        series: [
          { key: "posts", label: "投稿", color: C.blue, kind: "bar" },
          { key: "failed", label: "失敗", color: C.red, kind: "bar" },
          { key: "avg", label: "7日平均", color: C.muted, kind: "line", compare: true, hidden: daily.length <= 7 },
        ],
        format: (v) => `${num(v)}件`,
      };
    }
  }
}

export function MetricChart({ avatarId, accountId, height = 240, syncUrl = false }: { avatarId?: string; accountId?: string; height?: number; syncUrl?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialMetric = (syncUrl && METRICS.includes(params.get("metric") as MetricKey) ? params.get("metric") : "revenue") as MetricKey;
  const initialRange = (syncUrl && RANGES.some((r) => r.id === params.get("range")) ? params.get("range") : "30d") as Range;
  const [metric, setMetric] = useState<MetricKey>(initialMetric);
  const [range, setRange] = useState<Range>(initialRange);
  const [t, setT] = useState<Timeseries | null>(null);
  const [err, setErr] = useState("");
  const [table, setTable] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams({ range, ...(avatarId ? { avatarId } : {}), ...(accountId ? { accountId } : {}) });
    setErr("");
    api<Timeseries>(`/api/timeseries?${q}`)
      .then(setT)
      .catch((e) => setErr(e.message));
  }, [range, avatarId, accountId]);

  // 選んだ指標・期間を URL に残す（リロードしても同じ表示）
  useEffect(() => {
    if (!syncUrl) return;
    const q = new URLSearchParams(params.toString());
    q.set("metric", metric);
    q.set("range", range);
    router.replace(`${pathname}?${q}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, range, syncUrl]);

  const chart = useMemo(() => (t ? chartFor(metric, t.daily) : null), [t, metric]);
  const noData =
    !!t &&
    ((metric === "views" || metric === "engagementRate") && t.daily.every((d) => d.views === null)
      ? "閲覧数の記録がまだありません（X / Threads / note を接続すると毎日記録されます）"
      : metric === "followers" && t.daily.every((d) => d.followers === null)
        ? "フォロワー数の記録がまだありません（自動取得に対応していない媒体は 分析・収益 で手入力できます）"
        : "");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" role="tablist" aria-label="表示する指標">
        {METRICS.map((k) => {
          const c = t ? card(k, t) : null;
          const active = k === metric;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={active}
              onClick={() => setMetric(k)}
              className={`rounded-xl border p-3 text-left transition ${active ? "border-cyan-400/40 bg-cyan-500/[0.07]" : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]"}`}
            >
              <div className={`text-[11px] ${active ? "text-cyan-300" : "text-white/50"}`}>{c?.label ?? "…"}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
                <span className="text-lg font-bold tabular-nums">{c?.value ?? "—"}</span>
                {c?.delta}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-white/35">{c?.sub ?? ""}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/45">{HELP[metric]}</span>
          <span className="flex-1" />
          <button onClick={() => setTable(!table)} className="text-[11px] text-white/40 hover:text-white/70">
            {table ? "グラフで見る" : "表で見る"}
          </button>
          <div className="flex rounded-lg border border-white/[0.08] p-0.5">
            {RANGES.map((r) => (
              <button key={r.id} onClick={() => setRange(r.id)} className={`rounded-md px-2 py-0.5 text-[11px] ${range === r.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {err ? (
          <p className="text-xs text-red-300">{err}</p>
        ) : !t || !chart ? (
          <div style={{ height }} className="flex items-center justify-center text-xs text-white/40">
            読み込み中…
          </div>
        ) : noData ? (
          <div style={{ height }} className="flex items-center justify-center px-6 text-center text-xs text-white/40">
            {noData}
          </div>
        ) : table ? (
          <div className="max-h-[320px] overflow-auto text-xs">
            <table className="w-full">
              <thead className="sticky top-0 bg-[#111216] text-white/45">
                <tr>
                  <th className="py-1.5 text-left font-normal">日付</th>
                  {chart.series.map((s) => (
                    <th key={s.key} className="py-1.5 text-right font-normal">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.data.map((row) => (
                  <tr key={String(row.date)} className="border-t border-white/[0.04]">
                    <td className="py-1 text-white/60">{dayLabel(String(row.date))}</td>
                    {chart.series.map((s) => (
                      <td key={s.key} className="py-1 text-right tabular-nums">
                        {row[s.key] === null || row[s.key] === undefined ? "—" : chart.format(Number(row[s.key]))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <ComboChart key={metric} data={chart.data} xKey="date" xFormat={dayLabel} labelFormat={dayLabel} series={chart.series} formatLeft={chart.format} height={height} leftDomain={chart.leftDomain} />
            {metric === "followers" && (
              // フォロワー数（総数）は単位の規模が違うので別のグラフにする（1 つのグラフに軸は 1 本）
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <ComboChart
                  data={t.daily.map((d) => ({ date: d.date, followers: d.followers }))}
                  xKey="date"
                  xFormat={dayLabel}
                  labelFormat={dayLabel}
                  series={[{ key: "followers", label: "フォロワー数", color: C.green, kind: "line" }]}
                  formatLeft={(v) => `${num(v)}人`}
                  height={110}
                 
                  leftDomain={["auto", "auto"]}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 小さな推移（アバターカード用）。値が無い日は線を切らずにつなぐ */
export function Sparkline({ values, color = C.green, width = 120, height = 28 }: { values: (number | null)[]; color?: string; width?: number; height?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <span className="text-[10px] text-white/30">記録なし</span>;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => (max === min ? height / 2 : height - 3 - ((v - min) / (max - min)) * (height - 6));
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3} fill={color} />
    </svg>
  );
}
