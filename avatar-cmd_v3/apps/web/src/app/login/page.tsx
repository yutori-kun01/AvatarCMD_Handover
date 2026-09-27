"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Brain } from "lucide-react";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ configured: boolean; setupAllowed: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/auth/login").then((r) => r.json()).then(setState).catch(() => setState({ configured: true, setupAllowed: false }));
  }, []);

  const setup = state && !state.configured;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (setup && password !== confirm) return setError("確認用パスワードが一致しません");
    setBusy(true);
    const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "ログインに失敗しました");
    const next = params.get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0c0f] px-4 text-white">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6]">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Avatar CMD</div>
            <div className="text-xs text-white/40">{setup ? "管理者パスワードの初期設定" : "管理者ログイン"}</div>
          </div>
        </div>
        {setup && !state?.setupAllowed ? (
          <p className="text-sm text-amber-300">
            管理者パスワードが未設定です。サーバーの .env に ADMIN_PASSWORD を設定して再起動してください（scripts/setup-env.sh で自動生成できます）。
          </p>
        ) : (
          <>
            <label className="mb-1 block text-xs text-white/50">パスワード</label>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan-400/60"
            />
            {setup && (
              <>
                <label className="mb-1 block text-xs text-white/50">パスワード（確認）</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan-400/60"
                />
              </>
            )}
            {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
            <button
              disabled={busy || !password || !state}
              className="w-full rounded-lg bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "確認中…" : setup ? "設定してログイン" : "ログイン"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
