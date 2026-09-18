import type { Metadata } from "next";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";

export const metadata: Metadata = {
  title: "Avatar CMD | ダッシュボード",
  description: "AIアバターの運用状況を統合管理するコマンドセンター。",
};

/**
 * ダッシュボード共通シェル。
 * サイドバー・ヘッダー・スクロール領域を一箇所に集約し、
 * 各ページは本文のみを返す。
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-[#0b0c0f] text-white">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
