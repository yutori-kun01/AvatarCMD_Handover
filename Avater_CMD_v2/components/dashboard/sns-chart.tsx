"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

const engagementData = [
  { date: "1/27", x: 320, note: 180, threads: 95, instagram: 210, tiktok: 440 },
  { date: "1/28", x: 480, note: 210, threads: 120, instagram: 190, tiktok: 520 },
  { date: "1/29", x: 390, note: 240, threads: 88, instagram: 280, tiktok: 380 },
  { date: "1/30", x: 520, note: 190, threads: 150, instagram: 310, tiktok: 610 },
  { date: "1/31", x: 610, note: 280, threads: 170, instagram: 240, tiktok: 490 },
  { date: "2/1", x: 780, note: 340, threads: 200, instagram: 390, tiktok: 720 },
  { date: "2/2", x: 680, note: 310, threads: 185, instagram: 350, tiktok: 680 },
  { date: "2/3", x: 820, note: 360, threads: 210, instagram: 420, tiktok: 810 },
  { date: "2/4", x: 750, note: 290, threads: 195, instagram: 380, tiktok: 770 },
  { date: "2/5", x: 910, note: 380, threads: 230, instagram: 450, tiktok: 850 },
  { date: "2/6", x: 860, note: 350, threads: 215, instagram: 410, tiktok: 790 },
  { date: "2/7", x: 940, note: 400, threads: 245, instagram: 480, tiktok: 920 },
]

const revenueByAvatarData = [
  { name: "Haru", revenue: 182, color: "#a78bfa" },
  { name: "Kai", revenue: 256, color: "#22d3ee" },
  { name: "Mio", revenue: 198, color: "#34d399" },
  { name: "Ren", revenue: 124, color: "#fbbf24" },
  { name: "Sora", revenue: 87, color: "#f472b6" },
]

export function SnsChart() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          SNSエンゲージメント推移
        </h3>
        <div className="flex items-center gap-3">
          {[
            { label: "X", color: "#22d3ee" },
            { label: "note", color: "#34d399" },
            { label: "TikTok", color: "#fbbf24" },
          ].map((p) => (
            <div key={p.label} className="flex items-center gap-1">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-[10px] text-muted-foreground">
                {p.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4">
        <ChartContainer
          config={{
            x: { label: "X", color: "#22d3ee" },
            note: { label: "note", color: "#34d399" },
            tiktok: { label: "TikTok", color: "#fbbf24" },
          }}
          className="h-[200px] w-full"
        >
          <AreaChart data={engagementData}>
            <defs>
              <linearGradient id="xGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="noteGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="tiktokGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 16%)" />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 10 }}
              axisLine={{ stroke: "hsl(225, 12%, 16%)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              type="monotone"
              dataKey="x"
              stroke="#22d3ee"
              fill="url(#xGrad)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="note"
              stroke="#34d399"
              fill="url(#noteGrad)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="tiktok"
              stroke="#fbbf24"
              fill="url(#tiktokGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  )
}

export function RevenueChart() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          アバター別月間収益
        </h3>
        <span className="text-xs text-muted-foreground">単位: K(千円)</span>
      </div>
      <div className="p-4">
        <ChartContainer
          config={{
            revenue: { label: "収益", color: "#22d3ee" },
          }}
          className="h-[200px] w-full"
        >
          <BarChart data={revenueByAvatarData} barSize={32}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 16%)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 10 }}
              axisLine={{ stroke: "hsl(225, 12%, 16%)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `¥${v}K`}
            />
            <ChartTooltip
              content={<ChartTooltipContent />}
            />
            <Bar
              dataKey="revenue"
              radius={[6, 6, 0, 0]}
              fill="#22d3ee"
              opacity={0.8}
            />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  )
}
