// ================================================
// API ルート用の認可ヘルパー
// ================================================
// 各 route handler の入口でセッションとロールを確認する。
// middleware だけに頼らず、ルート単位でも検証する（多層防御）。

import { NextResponse } from "next/server";
import type { UserRole } from "@avatar-cmd/db";
import { auth } from "@/lib/auth";

export interface AuthedUser {
  id: string;
  email: string;
  role: UserRole;
}

/** 書き込み操作を許可するロール */
const WRITE_ROLES: UserRole[] = ["OWNER", "ADMIN", "OPERATOR"];

export class ApiAuthError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

/** ログイン済みユーザーを返す。未ログインなら 401。 */
export async function requireUser(): Promise<AuthedUser> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new ApiAuthError(401, "認証が必要です");
  }
  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
  };
}

/** 書き込み権限を持つユーザーを返す。VIEWER は 403。 */
export async function requireWriteUser(): Promise<AuthedUser> {
  const user = await requireUser();
  if (!WRITE_ROLES.includes(user.role)) {
    throw new ApiAuthError(403, "この操作を行う権限がありません");
  }
  return user;
}

/**
 * route handler の共通エラー処理。
 * 認可エラーはそのまま、それ以外は詳細を隠して 500 を返す
 * （Prisma の例外メッセージにはスキーマ情報が含まれるため）。
 */
export function handleApiError(context: string, error: unknown): NextResponse {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[api] ${context}:`, error);
  return NextResponse.json({ error: `${context}に失敗しました` }, { status: 500 });
}
