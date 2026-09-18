"use client";
import { useState, useEffect } from "react";

interface AnalyticsData {
  kpis: { label: string; value: number; previousValue: number; change: number; trend: string }[];
  avatarPerformance: { avatarId: string; name: string; followers: number; engRate: number; revenue: number; topPlatform: string; weeklyPosts: number }[];
  improvement: { pendingCycles: number; activeSuggestions: number; appliedThisWeek: number; suggestions: { id: string; avatarId: string; type: string; title: string; impact: string; description: string }[] };
}

export default function ActivityPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => { fetch("/api/analytics").then(r => r.json()).then(d => setData(d)); }, []);
  if (!data) return <div style={{ background: "#0b0c0f", minHeight: "100vh" }} />;

  const impactColor = (i: string) => i === "high" ? "#ef4444" : i === "medium" ? "#f59e0b" : "#22c55e";

  return (
    <>
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
        {data.kpis.slice(0, 3).map(kpi => (
          <div key={kpi.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{kpi.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{typeof kpi.value === "number" && kpi.value > 1000 ? kpi.value.toLocaleString() : kpi.value}{kpi.label.includes("率") ? "%" : ""}</div>
            <div style={{ fontSize: 13, color: kpi.trend === "up" ? "#22c55e" : "#ef4444", marginTop: 4 }}>
              {kpi.trend === "up" ? "↑" : "↓"} {kpi.change}% 先週比
            </div>
          </div>
        ))}
      </div>

      {/* Avatar Performance Table */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>アバターパフォーマンス</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["アバター", "フォロワー", "ENG率", "週間投稿", "収益", "メインSNS"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.avatarPerformance.map(a => (
                <tr key={a.avatarId} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: `hsl(${parseInt(a.avatarId) * 60}, 50%, 40%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{a.name[0]}</div>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px", fontSize: 14 }}>{a.followers.toLocaleString()}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ fontSize: 14, color: a.engRate > 5 ? "#22c55e" : a.engRate > 3 ? "#22d3ee" : "#f59e0b" }}>{a.engRate}%</span>
                  </td>
                  <td style={{ padding: "12px 14px", fontSize: 14 }}>{a.weeklyPosts}</td>
                  <td style={{ padding: "12px 14px", fontSize: 14 }}>¥{a.revenue.toLocaleString()}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "rgba(34,211,238,0.08)", color: "#22d3ee" }}>{a.topPlatform}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Improvement Suggestions */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>改善提案</h3>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            <span>保留: <span style={{ color: "#f59e0b" }}>{data.improvement.pendingCycles}</span></span>
            <span>提案: <span style={{ color: "#22d3ee" }}>{data.improvement.activeSuggestions}</span></span>
            <span>今週適用: <span style={{ color: "#22c55e" }}>{data.improvement.appliedThisWeek}</span></span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.improvement.suggestions.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 10, borderLeft: `3px solid ${impactColor(s.impact)}` }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{s.description}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: `${impactColor(s.impact)}20`, color: impactColor(s.impact) }}>{s.impact}</span>
                <button style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", fontSize: 12, cursor: "pointer" }}>適用</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
