"use client";
import { useState, useEffect } from "react";

interface PlatformInfo {
  platform: string;
  displayName: string;
  icon: string;
  authType: string;
  modes: string[];
  maxPostLength: number;
  supportsMedia: boolean;
  status: string;
}

interface ContentData {
  total: number;
  byStatus: Record<string, number>;
  byPlatform: Record<string, number>;
  queueSize: number;
  recent: { id: string; avatarId: string; platform: string; content: string; status: string; engagement?: { likes: number; comments: number; shares: number; views: number }; publishedAt?: string; scheduledAt?: string }[];
  campaigns: {
    total: number; active: number; completed: number; draft: number;
    activeCampaigns: { id: string; avatarId: string; title: string; type: string; platforms: string[]; contentCount: number; progress: number }[];
  };
}

export default function SnsOpsPage() {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [content, setContent] = useState<ContentData | null>(null);
  const [activeTab, setActiveTab] = useState<"platforms" | "content" | "campaigns">("platforms");

  useEffect(() => {
    fetch("/api/platforms").then(r => r.json()).then(d => setPlatforms(d.platforms));
    fetch("/api/content").then(r => r.json()).then(d => setContent(d));
  }, []);

  const tabs = [
    { key: "platforms" as const, label: "プラットフォーム", count: platforms.length },
    { key: "content" as const, label: "コンテンツ", count: content?.total || 0 },
    { key: "campaigns" as const, label: "キャンペーン", count: content?.campaigns?.active || 0 },
  ];

  const modeLabel = (m: string) => m === "hybrid" ? "API+Browser" : m === "api" ? "API" : "Browser";
  const modeColor = (m: string) => m === "hybrid" ? "#22d3ee" : m === "api" ? "#a78bfa" : "#fb923c";

  return (
    <>
      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 12 }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
              background: activeTab === tab.key ? "linear-gradient(135deg, #3b82f6, #8b5cf6)" : "rgba(255,255,255,0.05)", color: "#fff", transition: "all 0.2s" }}>
            {tab.label} <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.15)", padding: "2px 8px", borderRadius: 10, fontSize: 12 }}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Platforms Tab */}
      {activeTab === "platforms" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {platforms.map(p => (
            <div key={p.platform} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, transition: "border-color 0.2s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 24 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{p.displayName}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Max {p.maxPostLength.toLocaleString()} chars</div>
                  </div>
                </div>
                <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: p.status === "available" ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)", color: p.status === "available" ? "#22c55e" : "rgba(255,255,255,0.4)" }}>
                  {p.status === "available" ? "✓ Active" : "Coming Soon"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {p.modes.map(m => (
                  <span key={m} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: `1px solid ${modeColor(m)}40`, color: modeColor(m), background: `${modeColor(m)}10` }}>
                    {modeLabel(m)}
                  </span>
                ))}
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>
                  Auth: {p.authType}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content Tab */}
      {activeTab === "content" && content && (
        <div>
          {/* Status Overview */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
            {Object.entries(content.byStatus).map(([status, count]) => (
              <div key={status} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: status === "published" ? "#22c55e" : status === "failed" ? "#ef4444" : "#22d3ee" }}>{count}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{status}</div>
              </div>
            ))}
          </div>
          {/* Recent Content */}
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>最新コンテンツ</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {content.recent.map(item => (
              <div key={item.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "rgba(34,211,238,0.1)", color: "#22d3ee" }}>{item.platform}</span>
                    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: item.status === "published" ? "rgba(34,197,94,0.1)" : "rgba(251,191,36,0.1)", color: item.status === "published" ? "#22c55e" : "#fbbf24" }}>{item.status}</span>
                  </div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>{item.content}</div>
                </div>
                {item.engagement && (
                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    <span>❤️ {item.engagement.likes}</span>
                    <span>💬 {item.engagement.comments}</span>
                    <span>🔄 {item.engagement.shares}</span>
                    <span>👁 {item.engagement.views.toLocaleString()}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Campaigns Tab */}
      {activeTab === "campaigns" && content?.campaigns && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#22d3ee" }}>{content.campaigns.active}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>稼働中</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#22c55e" }}>{content.campaigns.completed}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>完了</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{content.campaigns.total}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>合計</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {content.campaigns.activeCampaigns.map(c => (
              <div key={c.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{c.type} · {c.contentCount} コンテンツ</div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#22d3ee" }}>{c.progress}%</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${c.progress}%`, background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", borderRadius: 4, transition: "width 0.5s ease" }} />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {c.platforms.map(p => (
                    <span key={p} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(34,211,238,0.08)", color: "#22d3ee" }}>{p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
