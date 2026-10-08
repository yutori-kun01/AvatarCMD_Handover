"use client";
// ダッシュボード各ページ共通のレイアウト
import { createContext, useContext } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

/** 別の画面のタブとして埋め込むとき（Shell の枠を出さず中身だけ描く） */
const EmbeddedContext = createContext(false);
export function Embedded({ children }: { children: React.ReactNode }) {
  return <EmbeddedContext.Provider value={true}>{children}</EmbeddedContext.Provider>;
}

export function Shell({ title, description, children, wide }: { title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  const embedded = useContext(EmbeddedContext);
  if (embedded) return <>{children}</>;
  return (
    <div className="flex min-h-screen bg-[#0b0c0f] text-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} description={description} />
        <main className="flex-1 overflow-auto p-6">
          <div className={`mx-auto ${wide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone = "text-white" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="text-xs text-white/45">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-white/40">{sub}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-white/40">{children}</div>;
}

/** 簡易棒グラフ（依存なし） */
export function relTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const t = new Date(d).getTime();
  const diff = (Date.now() - t) / 1000;
  const abs = Math.abs(diff);
  const fmt = (n: number, u: string) => `${Math.round(n)}${u}${diff >= 0 ? "前" : "後"}`;
  if (abs < 60) return diff >= 0 ? "たった今" : "まもなく";
  if (abs < 3600) return fmt(abs / 60, "分");
  if (abs < 86400) return fmt(abs / 3600, "時間");
  if (abs < 86400 * 30) return fmt(abs / 86400, "日");
  return new Date(d).toLocaleDateString("ja-JP");
}

export const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

export const AVATAR_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "稼働中", cls: "bg-emerald-500/15 text-emerald-300" },
  PAUSED: { label: "一時停止", cls: "bg-amber-500/15 text-amber-300" },
  LEARNING: { label: "学習中", cls: "bg-blue-500/15 text-blue-300" },
  ERROR: { label: "エラー", cls: "bg-red-500/15 text-red-300" },
};
