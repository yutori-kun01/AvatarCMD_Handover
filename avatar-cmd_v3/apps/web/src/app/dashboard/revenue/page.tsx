"use client";
import { useState, useEffect } from "react";

interface RevenueData {
  totalRevenue: number;
  currency: string;
  monthlyGrowth: number;
  byAvatar: { avatarId: string; name: string; total: number; growth: number }[];
  bySource: { source: string; total: number; percentage: number }[];
  byPlatform: { platform: string; total: number }[];
  monthly: { month: string; total: number }[];
}

export default function RevenuePage() {
  const [data, setData] = useState<RevenueData | null>(null);

  useEffect(() => { fetch("/api/revenue").then(r => r.json()).then(d => setData(d)); }, []);

  if (!data) return <div style={{ background: "#0b0c0f", minHeight: "100vh" }} />;

  const sourceLabels: Record<string, string> = {
    affiliate: "アフィリエイト", paid_content: "有料コンテンツ", sponsorship: "スポンサー",
    donation: "ドネーション", ad_revenue: "広告収入", subscription: "サブスク", merchandise: "物販",
  };
  const sourceColors: Record<string, string> = {
    affiliate: "#3b82f6", paid_content: "#8b5cf6", sponsorship: "#22d3ee",
    donation: "#f59e0b", ad_revenue: "#22c55e", subscription: "#ec4899", merchandise: "#f97316",
  };

  const maxMonthly = Math.max(...data.monthly.map(m => m.total));

  return (
    <>
      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        <div style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 14, padding: 24 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>月間収益</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>¥{data.totalRevenue.toLocaleString()}</div>
          <div style={{ fontSize: 13, color: "#22c55e", marginTop: 4 }}>↑ {data.monthlyGrowth}% 先月比</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>収益源</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>{data.bySource.length}</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>アクティブ収益チャネル</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>トップアバター</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>{data.byAvatar[0]?.name}</div>
          <div style={{ fontSize: 13, color: "#22d3ee", marginTop: 4 }}>¥{data.byAvatar[0]?.total.toLocaleString()}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Monthly Trend */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>月次推移</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 180 }}>
            {data.monthly.map(m => (
              <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>¥{(m.total / 1000).toFixed(0)}K</div>
                <div style={{ width: "100%", background: "linear-gradient(180deg, #3b82f6, #8b5cf6)", borderRadius: "4px 4px 0 0", height: `${(m.total / maxMonthly) * 140}px`, minHeight: 20, transition: "height 0.5s ease" }} />
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* By Source */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>収益源</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.bySource.map(s => (
              <div key={s.source}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{sourceLabels[s.source] || s.source}</span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>¥{s.total.toLocaleString()} ({s.percentage}%)</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${s.percentage}%`, background: sourceColors[s.source] || "#666", borderRadius: 4, transition: "width 0.5s" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Avatar Revenue Ranking */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, marginTop: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>アバター別収益</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {data.byAvatar.map((a, i) => (
            <div key={a.avatarId} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: 16, border: `1px solid ${i === 0 ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.06)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: `hsl(${i * 60}, 50%, 40%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{a.name[0]}</div>
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                </div>
                <span style={{ fontSize: 11, background: `rgba(34,197,94,${a.growth > 10 ? 0.15 : 0.08})`, padding: "2px 6px", borderRadius: 4, color: "#22c55e" }}>+{a.growth}%</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>¥{a.total.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
