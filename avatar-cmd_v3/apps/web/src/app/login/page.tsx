import { AuthError } from "next-auth"
import { redirect } from "next/navigation"
import { Brain } from "lucide-react"
import { signIn } from "@/auth"

export const metadata = { title: "ログイン | Avatar CMD" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const { error, callbackUrl } = await searchParams
  const safeCallback = toSafePath(callbackUrl)

  async function login(formData: FormData) {
    "use server"
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: safeCallback,
      })
    } catch (e) {
      if (e instanceof AuthError) {
        const code = (e as AuthError & { code?: string }).code === "rate_limited" ? "rate_limited" : "invalid"
        redirect(`/login?error=${code}`)
      }
      throw e
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050508] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6] shadow-lg shadow-blue-500/20">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-lg font-semibold">Avatar CMD</h1>
          <p className="text-xs text-muted-foreground">ディレクターとしてログイン</p>
        </div>
        <form action={login} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="text-xs text-muted-foreground">メールアドレス</label>
            <input id="email" name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary/40 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="password" className="text-xs text-muted-foreground">パスワード</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary/40 focus:outline-none" />
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error === "rate_limited" ? "ログイン試行回数が多すぎます。しばらくしてから再試行してください。" : "メールアドレスまたはパスワードが正しくありません。"}
            </p>
          )}
          <button type="submit" className="w-full rounded-lg bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40">
            ログイン
          </button>
        </form>
      </div>
    </div>
  )
}

// Keep only the path of the callback (the middleware may build it with the
// container's internal host). Never redirect off-site.
function toSafePath(callbackUrl?: string): string {
  if (!callbackUrl) return "/dashboard"
  try {
    const u = new URL(callbackUrl, "http://internal")
    const path = u.pathname + u.search
    return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/login") ? path : "/dashboard"
  } catch {
    return "/dashboard"
  }
}
