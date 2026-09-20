import { NextResponse } from "next/server";
import { requireUser, handleApiError, ApiAuthError } from "@/lib/api-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    if (!["OWNER", "ADMIN"].includes(user.role))
      return NextResponse.json(
        { error: "管理者のみ確認できます" },
        { status: 403 },
      );
    const response = await fetch("http://chrome-empire:4000/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok)
      return NextResponse.json(
        { error: "ブラウザワーカーに接続できません" },
        { status: 503 },
      );
    return NextResponse.json(await response.json());
  } catch (error) {
    if (error instanceof ApiAuthError) return handleApiError("ブラウザ状態取得", error);
    return NextResponse.json(
      { error: "ブラウザワーカーの状態を取得できません" },
      { status: 503 },
    );
  }
}
