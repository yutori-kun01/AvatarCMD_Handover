"use client";
import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";

const automationRules = [
  { id: "r1", name: "ゴールデンタイム自動投稿", description: "19-21時に予約済みコンテンツを自動投稿", trigger: "schedule", frequency: "daily", avatarIds: ["1", "2", "4"], platforms: ["x", "note"], enabled: true, lastRun: "10分前", successRate: 98.5 },
  { id: "r2", name: "トレンドキーワード収集", description: "X/TikTokのトレンドを1時間ごとにスキャン", trigger: "interval", frequency: "hourly", avatarIds: ["4"], platforms: ["x", "tiktok"], enabled: true, lastRun: "24分前", successRate: 99.2 },
  { id: "r3", name: "エンゲージメント自動返信", description: "条件に合うリプライに自動でいいね・返信", trigger: "event", frequency: "realtime", avatarIds: ["1", "3"], platforms: ["x", "instagram"], enabled: true, lastRun: "3分前", successRate: 94.8 },
  { id: "r4", name: "メトリクス定期収集", description: "全アバターの各SNSメトリクスを6時間ごと収集", trigger: "interval", frequency: "6hours", avatarIds: ["1", "2", "3", "4", "5"], platforms: ["x", "note", "zenn", "instagram", "youtube"], enabled: true, lastRun: "2時間前", successRate: 100 },
  { id: "r5", name: "改善サイクル自動実行", description: "毎週月曜にImprovementEngineを実行し提案生成", trigger: "schedule", frequency: "weekly", avatarIds: ["1", "2", "3", "4", "5"], platforms: [], enabled: true, lastRun: "3日前", successRate: 100 },
  { id: "r6", name: "セッション自動更新", description: "Browser-onlyプラットフォームのセッション期限前に自動再ログイン", trigger: "threshold", frequency: "as_needed", avatarIds: ["1", "3", "5"], platforms: ["note", "tiktok", "zenn"], enabled: true, lastRun: "1日前", successRate: 95.0 },
  { id: "r7", name: "A/Bテスト結果分析", description: "48時間後にバリアント比較して勝者を判定", trigger: "event", frequency: "on_complete", avatarIds: ["1", "2"], platforms: ["x"], enabled: false, lastRun: "5日前", successRate: 100 },
];

const avatarNames: Record<string, string> = { "1": "Haru", "2": "Kai", "3": "Mio", "4": "Ren", "5": "Sora" };

export default function AutomationPage() {
  const [rules, setRules] = useState(automationRules);

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const triggerLabel = (t: string) => t === "schedule" ? "⏰ スケジュール" : t === "interval" ? "🔁 インターバル" : t === "event" ? "⚡ イベント" : "📊 閾値";
  const triggerColor = (t: string) => t === "schedule" ? "#3b82f6" : t === "interval" ? "#22d3ee" : t === "event" ? "#f59e0b" : "#a78bfa";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0b0c0f", color: "#fff" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Header />
        <main style={{ flex: 1, padding: "24px", overflow: "auto" }}>
          {/* Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
            {[
              { label: "総ルール数", value: rules.length, color: "#fff" },
              { label: "有効", value: rules.filter(r => r.enabled).length, color: "#22c55e" },
              { label: "無効", value: rules.filter(r => !r.enabled).length, color: "#ef4444" },
              { label: "平均成功率", value: `${(rules.reduce((s, r) => s + r.successRate, 0) / rules.length).toFixed(1)}%`, color: "#22d3ee" },
            ].map(s => (
              <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Rules List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rules.map(rule => (
              <div key={rule.id} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${rule.enabled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)"}`, borderRadius: 14, padding: 20, opacity: rule.enabled ? 1 : 0.6, transition: "all 0.2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{rule.name}</span>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: `${triggerColor(rule.trigger)}15`, color: triggerColor(rule.trigger), border: `1px solid ${triggerColor(rule.trigger)}30` }}>{triggerLabel(rule.trigger)}</span>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>{rule.frequency}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>{rule.description}</div>
                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        アバター: {rule.avatarIds.map(id => avatarNames[id]).join(", ")}
                      </span>
                      {rule.platforms.length > 0 && (
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>
                          SNS: {rule.platforms.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    {/* Toggle */}
                    <button onClick={() => toggleRule(rule.id)} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: rule.enabled ? "#22c55e" : "rgba(255,255,255,0.15)", position: "relative", transition: "background 0.2s" }}>
                      <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: rule.enabled ? 23 : 3, transition: "left 0.2s" }} />
                    </button>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                      <span>最終: {rule.lastRun}</span>
                      <span style={{ color: rule.successRate > 97 ? "#22c55e" : rule.successRate > 90 ? "#f59e0b" : "#ef4444" }}>成功率: {rule.successRate}%</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Rule Button */}
          <button style={{ width: "100%", marginTop: 16, padding: "16px", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.15)", background: "transparent", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 14, fontWeight: 500 }}>
            + 新しい自動化ルールを追加
          </button>
        </main>
      </div>
    </div>
  );
}
