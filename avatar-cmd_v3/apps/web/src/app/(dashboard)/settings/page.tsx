"use client";
import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("general");

  const sections = [
    { key: "general", label: "一般設定" },
    { key: "security", label: "セキュリティ" },
    { key: "api", label: "API設定" },
    { key: "scheduler", label: "スケジューラ" },
    { key: "notifications", label: "通知" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0b0c0f", color: "#fff" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Header />
        <main style={{ flex: 1, padding: "24px", overflow: "auto" }}>
          <div style={{ display: "flex", gap: 24 }}>
            {/* Settings Sidebar */}
            <div style={{ width: 200, flexShrink: 0 }}>
              {sections.map(s => (
                <button key={s.key} onClick={() => setActiveSection(s.key)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, marginBottom: 4,
                    background: activeSection === s.key ? "rgba(34,211,238,0.08)" : "transparent", color: activeSection === s.key ? "#22d3ee" : "rgba(255,255,255,0.5)", transition: "all 0.15s" }}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Settings Content */}
            <div style={{ flex: 1 }}>
              {activeSection === "general" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <SettingCard title="システム情報" items={[
                    { label: "バージョン", value: "Avatar CMD v3.0.0" },
                    { label: "ランタイム", value: "Node.js 20 + Next.js 15" },
                    { label: "データベース", value: "PostgreSQL (Prisma ORM)" },
                    { label: "ブラウザエンジン", value: "Playwright Chromium" },
                  ]} />
                  <SettingCard title="アバター制限" items={[
                    { label: "最大アバター数", value: "10", editable: true },
                    { label: "同時実行ブラウザ", value: "5", editable: true },
                    { label: "1日あたり最大投稿数", value: "200", editable: true },
                  ]} />
                  <SettingCard title="言語 & タイムゾーン" items={[
                    { label: "表示言語", value: "日本語" },
                    { label: "タイムゾーン", value: "Asia/Tokyo (JST)" },
                    { label: "日付フォーマット", value: "YYYY-MM-DD" },
                  ]} />
                </div>
              )}
              {activeSection === "security" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <SettingCard title="暗号化" items={[
                    { label: "アルゴリズム", value: "AES-256-GCM ✓" },
                    { label: "キーローテーション", value: "30日ごと" },
                    { label: "ゼロトラスト設計", value: "有効 ✓" },
                  ]} />
                  <SettingCard title="セッション管理" items={[
                    { label: "プロファイル分離", value: "全アバター隔離済み ✓" },
                    { label: "セッションTTL", value: "24時間" },
                    { label: "フィンガープリント保護", value: "有効 ✓" },
                  ]} />
                  <SettingCard title="APIトークン" items={[
                    { label: "有効なトークン", value: "5 / 5" },
                    { label: "最終監査", value: "2分前" },
                    { label: "レート制限", value: "プラットフォーム別設定済み" },
                  ]} />
                </div>
              )}
              {activeSection === "api" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <SettingCard title="プラットフォームAPI" items={[
                    { label: "X (Twitter)", value: "OAuth 2.0 PKCE — 接続済み", hasStatus: true },
                    { label: "YouTube", value: "Data API v3 — 接続済み", hasStatus: true },
                    { label: "Facebook / Instagram", value: "Graph API — 接続済み", hasStatus: true },
                    { label: "Bluesky", value: "AT Protocol — 接続済み", hasStatus: true },
                    { label: "WordPress", value: "REST v2 — 接続済み", hasStatus: true },
                    { label: "LinkedIn", value: "Marketing API — 接続済み", hasStatus: true },
                  ]} />
                  <SettingCard title="Chrome Empire 設定" items={[
                    { label: "最大プール", value: "5 インスタンス", editable: true },
                    { label: "ステルスモード", value: "有効" },
                    { label: "ヘッドレス", value: "有効" },
                    { label: "ヘルスチェック間隔", value: "30秒", editable: true },
                  ]} />
                </div>
              )}
              {activeSection === "scheduler" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <SettingCard title="スケジューラ設定" items={[
                    { label: "ステータス", value: "稼働中 ✓" },
                    { label: "ティック間隔", value: "30秒", editable: true },
                    { label: "最大リトライ", value: "3回", editable: true },
                    { label: "バックオフ方式", value: "指数バックオフ (4^n min)" },
                  ]} />
                  <SettingCard title="ジョブ統計" items={[
                    { label: "登録ジョブ", value: "24 件" },
                    { label: "有効", value: "22 件" },
                    { label: "成功率", value: "97.8%" },
                    { label: "次回実行", value: "19:00 JST" },
                  ]} />
                </div>
              )}
              {activeSection === "notifications" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <SettingCard title="通知チャネル" items={[
                    { label: "ダッシュボード通知", value: "有効 ✓" },
                    { label: "メール通知", value: "無効" },
                    { label: "Webhook (Discord)", value: "未設定", editable: true },
                    { label: "Webhook (Slack)", value: "未設定", editable: true },
                  ]} />
                  <SettingCard title="通知ルール" items={[
                    { label: "投稿失敗", value: "即時通知" },
                    { label: "アバター停止", value: "即時通知" },
                    { label: "改善提案", value: "1日1回まとめ" },
                    { label: "収益レポート", value: "毎週月曜 9:00" },
                  ]} />
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function SettingCard({ title, items }: { title: string; items: { label: string; value: string; editable?: boolean; hasStatus?: boolean }[] }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map(item => (
          <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{item.label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {item.hasStatus && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />}
              <span style={{ fontSize: 13, color: item.hasStatus ? "#22c55e" : "rgba(255,255,255,0.8)" }}>{item.value}</span>
              {item.editable && (
                <button style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#22d3ee", fontSize: 11, cursor: "pointer" }}>編集</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
