import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/lib/actions/auth";

export const metadata: Metadata = {
  title: "Avatar CMD | ダッシュボード",
  description: "AIアバターの運用状況を統合管理するコマンドセンター。",
};

/**
 * ダッシュボード共通シェル。
 * サイドバー・ヘッダー・スクロール領域を一箇所に集約し、
 * 各ページは本文のみを返す。
 * middleware に加えてここでもセッションを確認する（多層防御）。
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fdashboard");

  return (
    <div className="flex h-screen bg-[#0b0c0f] text-white">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          user={{
            name: session.user.name ?? "",
            email: session.user.email ?? "",
            role: session.user.role,
          }}
          onSignOut={signOutAction}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
