// ================================================
// Avatar CMD — Revenue API
// ================================================

import { NextResponse } from "next/server";

export async function GET() {
  const revenue = {
    totalRevenue: 847000,
    currency: "JPY",
    monthlyGrowth: 8.6,
    byAvatar: [
      { avatarId: "2", name: "Kai", total: 256000, growth: 12.4 },
      { avatarId: "3", name: "Mio", total: 198000, growth: 6.8 },
      { avatarId: "1", name: "Haru", total: 182000, growth: 9.2 },
      { avatarId: "4", name: "Ren", total: 124000, growth: 4.1 },
      { avatarId: "5", name: "Sora", total: 87000, growth: 15.3 },
    ],
    bySource: [
      { source: "affiliate", total: 312000, percentage: 36.8 },
      { source: "paid_content", total: 234000, percentage: 27.6 },
      { source: "sponsorship", total: 156000, percentage: 18.4 },
      { source: "donation", total: 89000, percentage: 10.5 },
      { source: "ad_revenue", total: 56000, percentage: 6.6 },
    ],
    byPlatform: [
      { platform: "zenn", total: 198000 },
      { platform: "x", total: 187000 },
      { platform: "note", total: 156000 },
      { platform: "youtube", total: 134000 },
      { platform: "instagram", total: 98000 },
      { platform: "other", total: 74000 },
    ],
    monthly: [
      { month: "2025-10", total: 612000 },
      { month: "2025-11", total: 689000 },
      { month: "2025-12", total: 723000 },
      { month: "2026-01", total: 745000 },
      { month: "2026-02", total: 780000 },
      { month: "2026-03", total: 847000 },
    ],
  };
  return NextResponse.json(revenue);
}
