"use client";
// 棒・折れ線・面を組み合わせて表示するグラフ（Stripe のダッシュボード風）
// ・表示切替: 組み合わせ（系列ごとの既定）/ 棒 / 折れ線 / 面
// ・凡例をクリックすると系列の表示・非表示を切り替え
// ・比較用の系列（前月など）は点線、右軸に置く系列は right を指定
import { useId, useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";

/**
 * Avatar CMD の配色（ロゴ・ボタンのグラデーション #4f7cff → #8b5cf6 と、テーマの chart トークン）。
 * グラフはここの色だけを使う。
 */
export const CHART_COLORS = {
  /** 主役の数値（収益など）: ブランドのグラデーション */
  brand: "#6d6af8",
  brandFrom: "#8b5cf6",
  brandTo: "#4f7cff",
  blue: "#4f7cff",
  violet: "#8b5cf6",
  /** --chart-1 / --primary（シアン） */
  cyan: "#18c5dc",
  /** --chart-2 / --accent（グリーン） */
  green: "#22c38e",
  /** --chart-3（アンバー）: 平均線 */
  amber: "#f49d25",
  /** --destructive: 失敗・エラー */
  red: "#df3a3a",
  /** 比較（前月など） */
  muted: "rgba(255,255,255,0.4)",
} as const;

export type SeriesKind = "bar" | "line" | "area";
export interface Series {
  key: string;
  label: string;
  color: string;
  kind: SeriesKind;
  /** 右軸（件数・人数など単位が違うもの） */
  right?: boolean;
  /** 比較用（点線・表示切替の対象外） */
  compare?: boolean;
  /** 最初は非表示 */
  hidden?: boolean;
  /** 棒・面のグラデーション（上 → 下）。ブランドの棒は [brandFrom, brandTo] */
  gradient?: [string, string];
  /** 同じ値の棒を積み上げる（増加・減少を 1 本の位置に描くなど） */
  stack?: string;
}
type Mode = "combo" | SeriesKind;
const MODES: { id: Mode; label: string }[] = [
  { id: "combo", label: "組み合わせ" },
  { id: "bar", label: "棒" },
  { id: "line", label: "折れ線" },
  { id: "area", label: "面" },
];

const axis = { stroke: "rgba(255,255,255,0.3)", fontSize: 10, tickLine: false, axisLine: false } as const;
export const compact = (v: number) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : v.toLocaleString("ja-JP"));

function ChartTooltip({
  active,
  payload,
  label,
  series,
  formatLeft,
  formatRight,
  labelFormat,
}: TooltipProps<number, string> & { series: Series[]; formatLeft: (v: number) => string; formatRight: (v: number) => string; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0b0c0f]/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1 text-white/50">{labelFormat ? labelFormat(String(label)) : label}</div>
      {series
        .map((s) => ({ s, p: payload.find((p) => p.dataKey === s.key) }))
        .filter((x) => x.p && x.p.value !== null && x.p.value !== undefined)
        .map(({ s, p }) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: s.gradient ? `linear-gradient(135deg, ${s.gradient[1]}, ${s.gradient[0]})` : s.color, opacity: s.compare ? 0.6 : 1 }} />
            <span className="flex-1 text-white/60">{s.label}</span>
            <span className="font-semibold tabular-nums">{(s.right ? formatRight : formatLeft)(Number(p!.value))}</span>
          </div>
        ))}
    </div>
  );
}

export function ComboChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 220,
  formatLeft = compact,
  formatRight = compact,
  xFormat,
  labelFormat,
  modes = true,
  leftDomain,
}: {
  data: T[];
  xKey: keyof T & string;
  series: Series[];
  height?: number;
  formatLeft?: (v: number) => string;
  formatRight?: (v: number) => string;
  xFormat?: (v: string) => string;
  labelFormat?: (l: string) => string;
  /** 表示切替ボタンを出すか */
  modes?: boolean;
  /** 左軸の範囲（フォロワー数など 0 から始めない場合） */
  leftDomain?: [number | string, number | string];
}) {
  const uid = useId().replace(/:/g, "");
  const [mode, setMode] = useState<Mode>("combo");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(series.filter((s) => s.hidden).map((s) => s.key)));
  const visible = series.filter((s) => !hidden.has(s.key));
  const hasRight = visible.some((s) => s.right);
  const interval = Math.max(0, Math.ceil(data.length / 10) - 1);
  // 棒が複数あると細くなりすぎるので、棒の数で太さを調整
  const bars = visible.filter((s) => (mode === "combo" || s.compare ? s.kind : mode) === "bar").length;
  const barSize = useMemo(() => Math.max(3, Math.min(28, Math.floor(600 / Math.max(1, data.length) / Math.max(1, bars)))), [data.length, bars]);

  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else if (series.length - n.size > 1) n.add(k);
      return n;
    });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {series.map((s) => (
          <button
            key={s.key}
            onClick={() => toggle(s.key)}
            className={`flex items-center gap-1.5 text-[11px] transition ${hidden.has(s.key) ? "text-white/25" : "text-white/70 hover:text-white"}`}
            title="クリックで表示・非表示"
          >
            {s.compare ? (
              <span className="w-3 border-t-2 border-dashed" style={{ borderColor: hidden.has(s.key) ? "rgba(255,255,255,0.2)" : s.color }} />
            ) : (
              <span
                className={`h-2.5 w-2.5 ${s.kind === "bar" && mode !== "line" ? "rounded-sm" : "rounded-full"}`}
                style={{ background: hidden.has(s.key) ? "rgba(255,255,255,0.2)" : s.gradient ? `linear-gradient(135deg, ${s.gradient[1]}, ${s.gradient[0]})` : s.color }}
              />
            )}
            {s.label}
          </button>
        ))}
        <span className="flex-1" />
        {modes && (
          <div className="flex rounded-lg border border-white/[0.08] p-0.5">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} className={`rounded-md px-2 py-0.5 text-[10px] ${mode === m.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: hasRight ? 0 : 6, bottom: 0, left: 0 }} barGap={2}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.gradient?.[0] ?? s.color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={s.gradient?.[1] ?? s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
              {series
                .filter((s) => s.gradient)
                .map((s) => (
                  <linearGradient key={`${s.key}-bar`} id={`${uid}-${s.key}-bar`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.gradient![0]} />
                    <stop offset="100%" stopColor={s.gradient![1]} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey={xKey} {...axis} interval={interval} tickFormatter={xFormat} minTickGap={4} />
            <YAxis yAxisId="left" {...axis} width={48} domain={leftDomain} allowDecimals={false} tickFormatter={(v) => compact(Number(v))} />
            {hasRight && <YAxis yAxisId="right" orientation="right" {...axis} width={36} allowDecimals={false} tickFormatter={(v) => compact(Number(v))} />}
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.15)" }}
              content={<ChartTooltip series={visible} formatLeft={formatLeft} formatRight={formatRight} labelFormat={labelFormat} />}
            />
            {visible.map((s) => {
              const kind = s.compare || mode === "combo" ? s.kind : mode;
              const common = { dataKey: s.key, name: s.label, yAxisId: s.right ? "right" : "left", isAnimationActive: false };
              if (kind === "bar") return <Bar key={s.key} {...common} stackId={s.stack} fill={s.gradient ? `url(#${uid}-${s.key}-bar)` : s.color} fillOpacity={s.compare ? 0.35 : 0.9} radius={[3, 3, 0, 0]} barSize={barSize} />;
              if (kind === "area")
                return (
                  <Area
                    key={s.key}
                    {...common}
                    type="monotone"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.compare ? "5 4" : undefined}
                    fill={s.compare ? "transparent" : `url(#${uid}-${s.key})`}
                    connectNulls
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                );
              return <Line key={s.key} {...common} type="monotone" stroke={s.color} strokeWidth={s.compare ? 1.5 : 2} strokeDasharray={s.compare ? "5 4" : undefined} strokeOpacity={s.compare ? 0.7 : 1} dot={false} activeDot={{ r: 3 }} connectNulls />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Stripe 風: タイトル・大きな数字・前期比 + グラフ */
export function MetricCard({
  title,
  value,
  delta,
  sub,
  children,
  className = "",
}: {
  title: string;
  value?: React.ReactNode;
  /** 前期比（%）。null は比較できない */
  delta?: number | null;
  sub?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 ${className}`}>
      <div className="text-xs text-white/50">{title}</div>
      {value !== undefined && (
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{value}</span>
          {delta !== undefined && delta !== null && (
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${delta >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
              {delta >= 0 ? "+" : ""}
              {delta}%
            </span>
          )}
          {sub && <span className="text-[11px] text-white/40">{sub}</span>}
        </div>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** 累計を足した配列を返す */
export function withCumulative<T extends Record<string, unknown>>(rows: T[], pairs: [string, string][]): (T & Record<string, number | null>)[] {
  const acc: Record<string, number> = {};
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    for (const [from, to] of pairs) {
      const v = r[from];
      if (v === null || v === undefined) {
        out[to] = null;
        continue;
      }
      acc[to] = (acc[to] ?? 0) + Number(v);
      out[to] = acc[to];
    }
    return out as T & Record<string, number | null>;
  });
}

/** 移動平均（n 件） */
export function movingAverage(values: number[], n: number): (number | null)[] {
  return values.map((_, i) => (i + 1 < Math.min(n, values.length) ? null : Math.round((values.slice(Math.max(0, i - n + 1), i + 1).reduce((s, x) => s + x, 0) / Math.min(n, i + 1)) * 10) / 10));
}
