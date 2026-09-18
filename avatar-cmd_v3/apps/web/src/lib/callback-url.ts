/**
 * ログイン後の遷移先を検証する。
 * オープンリダイレクトを避けるため自サイト内のパスのみを許可する。
 */
export function safeCallbackUrl(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}
