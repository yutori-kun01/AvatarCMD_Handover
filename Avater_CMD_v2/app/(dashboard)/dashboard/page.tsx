"use client"

import { useState } from "react"
import { Sidebar, type PageId } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { AvatarCards } from "@/components/dashboard/avatar-cards"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { SnsChart, RevenueChart } from "@/components/dashboard/sns-chart"
import { CollabNetwork } from "@/components/dashboard/collab-network"
import { AvatarsPage } from "@/components/dashboard/pages/avatars-page"
import { ActivityPage } from "@/components/dashboard/pages/activity-page"
import { SnsPage } from "@/components/dashboard/pages/sns-page"
import { RevenuePage } from "@/components/dashboard/pages/revenue-page"
import { KnowledgePage } from "@/components/dashboard/pages/knowledge-page"
import { CollabPage } from "@/components/dashboard/pages/collab-page"
import { AutomationPage } from "@/components/dashboard/pages/automation-page"
import { SettingsPage } from "@/components/dashboard/pages/settings-page"

export default function Page() {
  const [activePage, setActivePage] = useState<PageId>("dashboard")

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header activePage={activePage} onNavigate={setActivePage} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1600px]">
            {activePage === "dashboard" && (
              <div className="space-y-6">
                <StatsCards />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <SnsChart />
                  <RevenueChart />
                </div>
                <AvatarCards />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                  <div className="lg:col-span-3">
                    <CollabNetwork />
                  </div>
                  <div className="lg:col-span-2">
                    <ActivityFeed />
                  </div>
                </div>
              </div>
            )}
            {activePage === "avatars" && <AvatarsPage />}
            {activePage === "activity" && <ActivityPage />}
            {activePage === "sns" && <SnsPage />}
            {activePage === "revenue" && <RevenuePage />}
            {activePage === "collab" && <CollabPage />}
            {activePage === "knowledge" && <KnowledgePage />}
            {activePage === "automation" && <AutomationPage />}
            {activePage === "settings" && <SettingsPage />}
          </div>
        </main>
      </div>
    </div>
  )
}
