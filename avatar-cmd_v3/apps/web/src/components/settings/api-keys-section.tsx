"use client";
// 設定 > 外部 AI API: API キーの発行・失効と、呼び出し記録（監査ログ）
import { useCallback, useEffect, useState } from "react";
import { api, Badge, Button, Card, CopyText, Field, Notice } from "./ui";

interface Key {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  avatarIds: string[];
  allAvatars: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: "active" | "revoked" | "expired";
}
interface Audit { id: string; keyId: string | null; method: string; path: string; status: number; latencyMs: number | null; error: string | null; createdAt: string }

export function ApiKeysSection({ avatars, onChanged }: { avatars: { id: string; name: string }[]; onChanged: (msg: string, ok: boolean) => void }) {
  const [data, setData] = useState<{ keys: Key[]; audit: Audit[]; scopes: { id: string; label: string }[]; routes: { method: string; path: string; scope: string }[] } | null>(null);
  const [form, setForm] = useState({ name: "", scopes: ["read"] as string[], avatarIds: [] as string[], allAvatars: false, expiresInDays: "90" });
  const [issued, setIssued] = useState<string | null>(null);

  const load = useCallback(async () => setData(await api("/api/api-keys")), []);
  // onChanged は親の再描画ごとに作り直されるため依存に入れない（入れると読み込みが繰り返される）
  useEffect(() => {
    load().catch((e) => onChanged(e.message, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const keyName = (id: string | null) => data?.keys.find((k) => k.id === id)?.name ?? "（認証なし・不正なキー）";

  async function issue() {
    try {
      const r = await api<{ key: string }>("/api/api-keys", {
        method: "POST",
        json: { name: form.name, scopes: form.scopes, avatarIds: form.avatarIds, allAvatars: form.allAvatars, expiresInDays: form.expiresInDays.trim() ? Number(form.expiresInDays) : null },
      });
      setIssued(r.key);
      setForm({ ...form, name: "" });
      await load();
    } catch (e) {
      onChanged((e as Error).message, false);
    }
  }

  if (!data) return <p className="text-sm text-white/40">読み込み中…</p>;
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">API キーを発行</h3>
        <p className="text-xs text-white/50">
          外部の AI エージェントから <code>/api/v1</code> を操作するためのキーです。権限と操作できるアバターを必要な分だけ付けてください。キーは発行時に1回だけ表示され、再表示できません（紛失したら失効して発行し直します）。
        </p>
        <Field def={{ key: "name", label: "名前（用途がわかるように）", placeholder: "下書き作成エージェント", required: true }} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <div>
          <div className="mb-1 text-xs text-white/60">権限</div>
          <div className="flex flex-wrap gap-2">
            {data.scopes.map((s) => (
              <button
                key={s.id}
                onClick={() => setForm({ ...form, scopes: toggle(form.scopes, s.id) })}
                className={`rounded-lg border px-3 py-1.5 text-xs ${form.scopes.includes(s.id) ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60"}`}
              >
                {s.id}（{s.label}）
              </button>
            ))}
          </div>
          {form.scopes.includes("publish") && <p className="mt-1 text-[11px] text-amber-300">publish を付けると、このキーで下書きを承認して投稿キューに入れられます。</p>}
        </div>
        <div>
          <div className="mb-1 text-xs text-white/60">操作できるアバター</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setForm({ ...form, allAvatars: !form.allAvatars })}
              className={`rounded-lg border px-3 py-1.5 text-xs ${form.allAvatars ? "border-amber-400/60 bg-amber-500/10 text-amber-200" : "border-white/10 text-white/60"}`}
            >
              すべてのアバター（今後追加するものも含む）
            </button>
            {!form.allAvatars &&
              avatars.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setForm({ ...form, avatarIds: toggle(form.avatarIds, a.id) })}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${form.avatarIds.includes(a.id) ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60"}`}
                >
                  {a.name}
                </button>
              ))}
          </div>
        </div>
        <Field def={{ key: "exp", label: "有効期限（日数。空欄で無期限）", placeholder: "90" }} value={form.expiresInDays} onChange={(v) => setForm({ ...form, expiresInDays: v })} />
        <Button onClick={issue} disabled={!form.name.trim() || !form.scopes.length || (!form.allAvatars && !form.avatarIds.length)}>
          発行
        </Button>
        {issued && (
          <Notice kind="ok" onClose={() => setIssued(null)}>
            <div className="space-y-2">
              <div>発行しました。このキーは今だけ表示されます。安全な場所に保存してください。</div>
              <CopyText text={issued} />
            </div>
          </Notice>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold">発行済みのキー</h3>
        {data.keys.length === 0 ? (
          <p className="text-xs text-white/40">まだありません</p>
        ) : (
          <div className="space-y-2">
            {data.keys.map((k) => (
              <div key={k.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] p-3 text-xs ${k.status === "active" ? "" : "opacity-60"}`}>
                <span className="font-medium">{k.name}</span>
                <code className="text-white/40">acmd_{k.prefix}_…</code>
                <Badge className={k.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/50"}>{k.status === "active" ? "有効" : k.status === "revoked" ? "失効" : "期限切れ"}</Badge>
                <span className="text-white/50">{k.scopes.join(", ")}</span>
                <span className="text-white/40">{k.allAvatars ? "全アバター" : k.avatarIds.map((id) => avatars.find((a) => a.id === id)?.name ?? "(削除済み)").join("、")}</span>
                <span className="flex-1" />
                <span className="text-white/35">
                  {k.expiresAt ? `期限 ${new Date(k.expiresAt).toLocaleDateString("ja-JP")}・` : ""}最終利用 {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("ja-JP") : "—"}
                </span>
                {k.status === "active" && (
                  <Button
                    variant="danger"
                    onClick={() =>
                      confirm(`「${k.name}」を失効しますか？（すぐに使えなくなり、元に戻せません）`) &&
                      api(`/api/api-keys/${k.id}`, { method: "DELETE" })
                        .then(() => (onChanged("失効しました", true), load()))
                        .catch((e) => onChanged(e.message, false))
                    }
                  >
                    失効
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold">最近の呼び出し（監査ログ。本文・キーは記録しません）</h3>
        {data.audit.length === 0 ? (
          <p className="text-xs text-white/40">まだありません</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {data.audit.map((a) => (
                <tr key={a.id} className="border-t border-white/[0.05]">
                  <td className="py-1 text-white/40">{new Date(a.createdAt).toLocaleString("ja-JP")}</td>
                  <td>{keyName(a.keyId)}</td>
                  <td>
                    <code>
                      {a.method} {a.path}
                    </code>
                  </td>
                  <td className={a.status >= 400 ? "text-red-300" : "text-emerald-300"}>{a.status}</td>
                  <td className="max-w-[18rem] truncate text-white/40">{a.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-semibold">使える API（詳しくは docs/API_V1.md）</h3>
        <table className="w-full text-xs">
          <tbody>
            {data.routes.map((r) => (
              <tr key={`${r.method} ${r.path}`} className="border-t border-white/[0.05]">
                <td className="py-1">
                  <code>{r.method}</code>
                </td>
                <td>
                  <code>{r.path}</code>
                </td>
                <td className="text-white/45">{r.scope}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
