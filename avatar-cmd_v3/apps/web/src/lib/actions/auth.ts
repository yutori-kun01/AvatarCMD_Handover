"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { safeCallbackUrl } from "@/lib/callback-url";

/**
 * ログインフォーム用のサーバーアクション。
 *
 * signIn の内部リダイレクトは AUTH_URL の設定有無で挙動が変わる
 * （絶対URLを返したり、リダイレクトせず戻ったりする）ため、
 * redirect: false にして遷移は自分で行う。
 */
export async function signInAction(formData: FormData): Promise<void> {
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl")?.toString());

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // 失敗の理由は返さない（ユーザー列挙対策）
      redirect(
        `/login?error=CredentialsSignin&callbackUrl=${encodeURIComponent(callbackUrl)}`
      );
    }
    throw error;
  }

  // redirect は NEXT_REDIRECT を投げるので try の外で呼ぶ
  redirect(callbackUrl);
}

/** ヘッダーのログアウトボタン用のサーバーアクション */
export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false });
  redirect("/login");
}
