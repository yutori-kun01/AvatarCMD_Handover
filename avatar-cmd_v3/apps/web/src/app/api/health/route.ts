// ================================================
// /api/health — コンテナのヘルスチェック
// ================================================
// docker compose の healthcheck と Cloudflare Tunnel の
// 疎通確認から参照する。認証不要（middleware の公開パス）。

import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // DB まで到達できて初めて healthy とみなす
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "ok",
      uptime: Math.floor(process.uptime()),
    });
  } catch (error) {
    console.error("[api] health check failed:", error);
    return NextResponse.json(
      { status: "error", database: "unreachable" },
      { status: 503 }
    );
  }
}
