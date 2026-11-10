"use client";
// 設定 > システム > セキュリティ: 2 段階認証・ログイン中の端末・ログイン履歴（admin-security.ts）
import { useCallback, useEffect, useState } from "react";
import { api, Badge, Button, Card, Field } from "./ui";

type OnChanged = (msg: string, ok: boolean) => void;

interface SecurityInfo {
  totp: { enabled: boolean; recoveryCodesLeft: number };
  sessions: { createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; userAgent: string | null; current: boolean }[];
  events: { id: string; action: string; details: Record<string, unknown>; ipAddress: string | null; userAgent: string | null; createdAt: string }[];
  rules: { perIpFailures: number; globalFailures: number; windowMinutes: number; idleHours: number; sessionDays: number };
}

const ACTION: Record<string, { label: string; cls: string }> = {
  login_success: { label: "ログイン", cls: "bg-emerald-500/15 text-emerald-300" },
  login_failed: { label: "ログイン失敗", cls: "bg-red-500/15 text-red-300" },
  login_blocked: { label: "ログイン停止中の試行", cls: "bg-red-500/25 text-red-200" },
  logout: { label: "ログアウト", cls: "bg-white/10 text-white/60" },
  password_changed: { label: "パスワード変更", cls: "bg-amber-500/15 text-amber-300" },
  sessions_revoked: { label: "他の端末をログアウト", cls: "bg-amber-500/15 text-amber-300" },
  totp_enabled: { label: "2 段階認証を有効化", cls: "bg-emerald-500/15 text-emerald-300" },
  totp_disabled: { label: "2 段階認証を無効化", cls: "bg-red-500/15 text-red-300" },
  recovery_code_used: { label: "回復コードを使用", cls: "bg-amber-500/15 text-amber-300" },
};

const fmt = (s: string) => new Date(s).toLocaleString("ja-JP");

/** ブラウザ名をざっくり（表示用） */
function browserOf(ua: string | null): string {
  if (!ua) return "不明";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ua.slice(0, 30);
  return os ? `${br}（${os}）` : br;
}

export function AccountSecurity({ onChanged }: { onChanged: OnChanged }) {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disable, setDisable] = useState({ password: "", code: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<SecurityInfo>("/api/settings/security").then(setInfo), []);
  useEffect(() => {
    load().catch((e) => onChanged((e as Error).message, false));
  }, [load, onChanged]);

  async function act<T>(name: string, json: Record<string, unknown>, after: (r: T) => void) {
    setBusy(name);
    try {
      after(await api<T>("/api/settings/security", { method: "POST", json: { action: name, ...json } }));
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  if (!info) return <p className="text-sm text-white/40">読み込み中…</p>;
  const r = info.rules;

  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">2 段階認証（認証アプリ）</h3>
          <Badge className={info.totp.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}>{info.totp.enabled ? "有効" : "無効"}</Badge>
        </div>
        <p className="text-xs text-white/60">
          パスワードに加えて、スマホの認証アプリ（Google Authenticator・Microsoft Authenticator・1Password など）の 6 桁のコードでログインします。
          パスワードが漏れても、スマホが無ければログインできません。<span className="text-amber-300">有効にすることを強くおすすめします。</span>
        </p>

        {recovery && (
          <div className="space-y-2 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold text-amber-200">回復コード（この画面でしか表示しません）</p>
            <p className="text-[11px] text-amber-100/80">スマホを無くしたときに、6 桁のコードの代わりに 1 回ずつ使えます。紙に書くかパスワード管理アプリに保存し、他の人に見せないでください。</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm md:grid-cols-5">
              {recovery.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setRecovery(null)}>
              保存しました
            </Button>
          </div>
        )}

        {info.totp.enabled ? (
          <div className="space-y-3">
            <p className="text-xs text-white/50">残りの回復コード: {info.totp.recoveryCodesLeft} 個{info.totp.recoveryCodesLeft <= 3 && "（少なくなっています。一度無効にして設定し直すと作り直せます）"}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field def={{ key: "p", label: "無効にする: パスワード", type: "password" }} value={disable.password} onChange={(v) => setDisable({ ...disable, password: v })} />
              <Field def={{ key: "c", label: "確認コード（6 桁か回復コード）" }} value={disable.code} onChange={(v) => setDisable({ ...disable, code: v })} />
            </div>
            <Button
              variant="danger"
              disabled={!!busy || !disable.password || !disable.code}
              onClick={() =>
                confirm("2 段階認証を無効にしますか？パスワードだけでログインできるようになります。") &&
                act<SecurityInfo>("totp_disable", disable, (d) => {
                  setInfo(d);
                  setDisable({ password: "", code: "" });
                  onChanged("2 段階認証を無効にしました", true);
                })
              }
            >
              2 段階認証を無効にする
            </Button>
          </div>
        ) : !setup ? (
          <Button disabled={!!busy} onClick={() => act<{ secret: string; uri: string; qr: string }>("totp_begin", {}, setSetup)}>
            2 段階認証を設定する
          </Button>
        ) : (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-white/70">
              <li>認証アプリで QR コードを読み取ってください（読み取れないときは下の文字列を手入力）。</li>
              <li>アプリに表示された 6 桁を入れて「有効にする」を押してください。</li>
            </ol>
            <div className="flex flex-wrap items-start gap-4">
              {/* QR はサーバーで作った SVG（認証アプリ登録用の URI だけを含む） */}
              <div className="rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qr }} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="break-all font-mono text-xs text-white/70">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
                <Field def={{ key: "code", label: "6 桁のコード" }} value={code} onChange={setCode} />
                <div className="flex gap-2">
                  <Button
                    disabled={!!busy || !/^\d{6}$/.test(code.trim())}
                    onClick={() =>
                      act<SecurityInfo & { recoveryCodes: string[] }>("totp_confirm", { code: code.trim() }, (d) => {
                        setInfo(d);
                        setRecovery(d.recoveryCodes);
                        setSetup(null);
                        setCode("");
                        onChanged("2 段階認証を有効にしました。回復コードを保存してください", true);
                      })
                    }
                  >
                    有効にする
                  </Button>
                  <Button variant="ghost" onClick={() => setSetup(null)}>
                    やめる
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">ログイン中の端末</h3>
          <span className="flex-1" />
          <Button
            variant="ghost"
            disabled={!!busy || info.sessions.length <= 1}
            onClick={() =>
              act<SecurityInfo & { revoked: number }>("revoke_others", {}, (d) => {
                setInfo(d);
                onChanged(`他の端末 ${d.revoked} 件をログアウトさせました`, true);
              })
            }
          >
            この端末以外をすべてログアウト
          </Button>
        </div>
        <p className="text-[11px] text-white/40">
          ログインは最長 {r.sessionDays} 日、操作が {r.idleHours} 時間なければ切れます。ログアウト・パスワード変更をすると、盗まれた Cookie も使えなくなります。
        </p>
        <div className="space-y-1.5">
          {info.sessions.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] px-3 py-2 text-xs">
              <span className="font-semibold">{browserOf(s.userAgent)}</span>
              <span className="text-white/50">IP {s.ip ?? "不明"}</span>
              <span className="text-white/40">ログイン {fmt(s.createdAt)}・最終操作 {fmt(s.lastSeenAt)}</span>
              {s.current && <Badge className="bg-cyan-500/15 text-cyan-300">この端末</Badge>}
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">ログイン履歴</h3>
        <p className="text-[11px] text-white/40">
          同じ IP からの失敗が {r.windowMinutes} 分に {r.perIpFailures} 回続くとその IP を、全体で {r.globalFailures} 回を超えるとすべてのログインを {r.windowMinutes} 分止めます。
          見覚えのないログインや失敗が続いているときは、パスワードを変更し、他の端末をログアウトさせてください。
        </p>
        {info.events.length === 0 ? (
          <p className="text-xs text-white/40">まだ記録がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <tbody>
                {info.events.map((e) => (
                  <tr key={e.id} className="border-b border-white/[0.04]">
                    <td className="py-1.5 pr-3 text-white/50 tabular-nums">{fmt(e.createdAt)}</td>
                    <td className="py-1.5 pr-3">
                      <Badge className={ACTION[e.action]?.cls ?? "bg-white/10 text-white/60"}>{ACTION[e.action]?.label ?? e.action}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-white/60">{e.ipAddress ?? "—"}</td>
                    <td className="py-1.5 text-white/40">{browserOf(e.userAgent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
