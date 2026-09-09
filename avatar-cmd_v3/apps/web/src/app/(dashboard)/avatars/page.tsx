"use client";
import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";

const avatars = [
  { id: "1", name: "Haru", role: "ADHD / 内向型", status: "active" as const, color: "#8b5cf6", platforms: ["X", "note", "Threads"], followers: "12.4K", engagement: 4.7, revenue: "¥182K", mood: 72, health: 92,
    persona: { tone: "共感的・やさしい", topics: ["ADHD", "内向型", "ライフハック"], postFreq: "1日3-5件", bestTime: "19:00-21:00" } },
  { id: "2", name: "Kai", role: "バイブコーダー", status: "active" as const, color: "#22d3ee", platforms: ["X", "Zenn", "YouTube"], followers: "8.7K", engagement: 5.2, revenue: "¥256K", mood: 85, health: 88,
    persona: { tone: "カジュアル・テック好き", topics: ["AI", "プログラミング", "ノーコード"], postFreq: "1日2-4件", bestTime: "12:00-14:00" } },
  { id: "3", name: "Mio", role: "ウェルネスコーチ", status: "learning" as const, color: "#22c55e", platforms: ["Instagram", "TikTok", "note"], followers: "23.1K", engagement: 6.1, revenue: "¥198K", mood: 60, health: 76,
    persona: { tone: "穏やか・ポジティブ", topics: ["マインドフルネス", "瞑想", "ヨガ"], postFreq: "1日1-2件", bestTime: "6:00-8:00" } },
  { id: "4", name: "Ren", role: "トレンドハンター", status: "active" as const, color: "#f59e0b", platforms: ["X", "TikTok"], followers: "31.2K", engagement: 3.8, revenue: "¥124K", mood: 90, health: 95,
    persona: { tone: "スピーディ・刺激的", topics: ["AI", "スタートアップ", "テクノロジー"], postFreq: "1日5-10件", bestTime: "8:00-10:00, 19:00-22:00" } },
  { id: "5", name: "Sora", role: "知識キュレーター", status: "paused" as const, color: "#ec4899", platforms: ["note", "Substack"], followers: "5.6K", engagement: 7.3, revenue: "¥87K", mood: 45, health: 60,
    persona: { tone: "知的・分析的", topics: ["哲学", "社会学", "未来予測"], postFreq: "週2-3件", bestTime: "21:00-23:00" } },
];

export default function AvatarsPage() {
  const [selectedId, setSelectedId] = useState<string | null>("1");
  const selected = avatars.find(a => a.id === selectedId);

  const statusMap = {
    active: { label: "稼働中", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    paused: { label: "一時停止", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
    learning: { label: "学習中", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0b0c0f", color: "#fff" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Header />
        <main style={{ flex: 1, padding: "24px", overflow: "auto" }}>
          <div style={{ display: "flex", gap: 24 }}>
            {/* Avatar List */}
            <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {avatars.map(a => {
                const st = statusMap[a.status];
                return (
                  <button key={a.id} onClick={() => setSelectedId(a.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, border: selectedId === a.id ? `1px solid ${a.color}40` : "1px solid rgba(255,255,255,0.06)", background: selectedId === a.id ? `${a.color}08` : "rgba(255,255,255,0.02)", cursor: "pointer", textAlign: "left", transition: "all 0.2s", width: "100%", color: "#fff" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${a.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: a.color, flexShrink: 0 }}>{a.name[0]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: st.bg, color: st.color }}>{st.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{a.role}</div>
                    </div>
                  </button>
                );
              })}
              <button style={{ padding: "14px 16px", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.15)", background: "transparent", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 13, fontWeight: 500, textAlign: "center" }}>
                + 新しいアバターを追加
              </button>
            </div>

            {/* Avatar Detail */}
            {selected && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Profile Header */}
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, display: "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ width: 64, height: 64, borderRadius: "50%", background: `${selected.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: selected.color }}>{selected.name[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{selected.name}</h2>
                      <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 6, background: statusMap[selected.status].bg, color: statusMap[selected.status].color }}>{statusMap[selected.status].label}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{selected.role}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 13, cursor: "pointer" }}>編集</button>
                    <button style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: selected.status === "active" ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)", color: selected.status === "active" ? "#f59e0b" : "#22c55e", fontSize: 13, cursor: "pointer" }}>
                      {selected.status === "active" ? "一時停止" : "再開"}
                    </button>
                  </div>
                </div>

                {/* Stats Row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                  {[
                    { label: "フォロワー", value: selected.followers, color: "#22d3ee" },
                    { label: "ENG率", value: `${selected.engagement}%`, color: "#22c55e" },
                    { label: "収益", value: selected.revenue, color: "#a78bfa" },
                    { label: "ムード", value: `${selected.mood}`, color: selected.mood > 70 ? "#22c55e" : "#f59e0b" },
                    { label: "ヘルス", value: `${selected.health}%`, color: selected.health > 80 ? "#22c55e" : "#f59e0b" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  {/* Persona */}
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>ペルソナ</h3>
                    {[
                      { l: "トーン", v: selected.persona.tone },
                      { l: "投稿頻度", v: selected.persona.postFreq },
                      { l: "ベストタイム", v: selected.persona.bestTime },
                    ].map(p => (
                      <div key={p.l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{p.l}</span>
                        <span style={{ fontSize: 13 }}>{p.v}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 12 }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>トピック</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {selected.persona.topics.map(t => (
                          <span key={t} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: `${selected.color}12`, color: selected.color, border: `1px solid ${selected.color}30` }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Platforms */}
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>接続プラットフォーム</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {selected.platforms.map(p => (
                        <div key={p} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
                          <span style={{ fontWeight: 500 }}>{p}</span>
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>接続済み</span>
                        </div>
                      ))}
                      <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px dashed rgba(255,255,255,0.15)", background: "transparent", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 12, textAlign: "center" }}>
                        + プラットフォームを追加
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
