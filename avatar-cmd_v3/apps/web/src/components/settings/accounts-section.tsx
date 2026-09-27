"use client";
// 「アカウント」: アバターごとに SNS アカウントを接続する（OAuth / アプリパスワード / トークン / Cookie）
import { useState } from "react";
import { ExternalLink, Link2, Trash2 } from "lucide-react";
import { api, Badge, Button, Card, Field, inputCls, LinkButton, SUPPORT_LABEL, type AccountInfo, type PlatformInfo } from "./ui";

function ConnectForm({ p, avatarId, onDone }: { p: PlatformInfo; avatarId: string; onDone: (msg: string, ok: boolean) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await api("/api/accounts", { method: "POST", json: { platform: p.id, avatarId, input: values } });
      setValues({});
      onDone(`${p.name}: ${r.accountName} を接続しました`, true);
    } catch (e) {
      onDone((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-white/[0.06] bg-black/20 p-4">
      {p.accountFields.map((f) => (
        <Field key={f.key} def={f} value={values[f.key] ?? ""} onChange={(v) => setValues({ ...values, [f.key]: v })} />
      ))}
      <Button onClick={submit} disabled={busy}>
        {busy ? "確認中…" : "接続を確認して保存"}
      </Button>
    </div>
  );
}

function AccountRow({ a, p, onChanged }: { a: AccountInfo; p?: PlatformInfo; onChanged: (msg: string, ok: boolean) => void }) {
  const [settings, setSettings] = useState<Record<string, string>>(() =>
    Object.fromEntries((p?.settingFields ?? []).map((f) => [f.key, String(a.settings[f.key] ?? f.default ?? "")]))
  );
  const [busy, setBusy] = useState(false);
  const expiry = a.tokenExpiry ? new Date(a.tokenExpiry) : null;
  const expired = expiry && expiry.getTime() < Date.now();

  async function save(extra?: { isActive?: boolean }) {
    setBusy(true);
    try {
      await api(`/api/accounts/${a.id}`, { method: "PATCH", json: { settings, ...extra } });
      onChanged(`${a.accountName} の設定を保存しました`, true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`${a.accountName} の接続を削除しますか？（保存された認証情報も削除されます）`)) return;
    try {
      await api(`/api/accounts/${a.id}`, { method: "DELETE" });
      onChanged(`${a.accountName} を削除しました`, true);
    } catch (e) {
      onChanged((e as Error).message, false);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span>{p?.icon}</span>
        <span className="text-sm font-semibold">{a.accountName}</span>
        <span className="text-xs text-white/40">{p?.name}</span>
        {a.profileUrl && (
          <a href={a.profileUrl} target="_blank" rel="noreferrer" className="text-white/30 hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <span className="flex-1" />
        {!a.isActive && <Badge className="bg-white/10 text-white/50">停止中</Badge>}
        {expired ? (
          <Badge className="bg-red-500/15 text-red-300">トークン期限切れ（再接続）</Badge>
        ) : expiry ? (
          <Badge className="bg-white/5 text-white/40">期限 {expiry.toLocaleString("ja-JP")}</Badge>
        ) : null}
      </div>
      {a.lastError && <p className="mt-2 break-all text-xs text-red-300">直近のエラー: {a.lastError}</p>}
      {(p?.settingFields.length ?? 0) > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {p!.settingFields.map((f) => (
            <Field key={f.key} def={f} value={settings[f.key] ?? ""} onChange={(v) => setSettings({ ...settings, [f.key]: v })} />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {(p?.settingFields.length ?? 0) > 0 && (
          <Button onClick={() => save()} disabled={busy}>
            設定を保存
          </Button>
        )}
        <Button variant="ghost" onClick={() => save({ isActive: !a.isActive })} disabled={busy}>
          {a.isActive ? "一時停止" : "再開"}
        </Button>
        {p?.connection === "oauth" && (
          <LinkButton variant="ghost" href={`/api/oauth/${a.platform}/start?avatarId=${a.avatarId}`}>
            再接続
          </LinkButton>
        )}
        <Button variant="danger" onClick={remove}>
          <Trash2 className="inline h-3 w-3" /> 削除
        </Button>
      </div>
    </div>
  );
}

export function AccountsSection({
  platforms,
  accounts,
  avatars,
  onChanged,
}: {
  platforms: PlatformInfo[];
  accounts: AccountInfo[];
  avatars: { id: string; name: string }[];
  onChanged: (msg: string, ok: boolean) => void;
}) {
  const [avatarId, setAvatarId] = useState(avatars[0]?.id ?? "");
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [newAvatar, setNewAvatar] = useState("");
  const mine = accounts.filter((a) => a.avatarId === avatarId);
  const byId = Object.fromEntries(platforms.map((p) => [p.id, p]));

  async function addAvatar() {
    try {
      const r = await api("/api/avatars", { method: "POST", json: { name: newAvatar } });
      setNewAvatar("");
      setAvatarId(r.avatar.id);
      onChanged(`アバター「${r.avatar.name}」を作成しました`, true);
    } catch (e) {
      onChanged((e as Error).message, false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[220px]">
            <span className="mb-1 block text-xs text-white/60">接続先のアバター</span>
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className={inputCls}>
              {avatars.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#111]">
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <input value={newAvatar} onChange={(e) => setNewAvatar(e.target.value)} placeholder="新しいアバター名" className={`${inputCls} w-48`} />
            <Button variant="ghost" onClick={addAvatar} disabled={!newAvatar.trim()}>
              追加
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold">接続済みアカウント（{mine.length}）</h3>
        {mine.length === 0 ? (
          <p className="text-xs text-white/40">まだ接続されていません。下の一覧から接続してください。</p>
        ) : (
          <div className="space-y-3">
            {mine.map((a) => (
              <AccountRow key={a.id + JSON.stringify(a.settings) + a.isActive} a={a} p={byId[a.platform]} onChanged={onChanged} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold">アカウントを接続</h3>
        <div className="space-y-2">
          {platforms.map((p) => {
            const appMissing = p.appFields.length > 0 && !p.app?.complete;
            return (
              <div key={p.id} className="rounded-xl border border-white/[0.06] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{p.icon}</span>
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge className={SUPPORT_LABEL[p.support].cls}>{SUPPORT_LABEL[p.support].label}</Badge>
                  <span className="flex-1" />
                  {p.connection === "none" ? (
                    <span className="text-xs text-white/40">{p.notes[0]}</span>
                  ) : appMissing ? (
                    <span className="text-xs text-amber-300">先に「SNS連携アプリ」でアプリ情報を登録してください</span>
                  ) : p.connection === "oauth" ? (
                    <LinkButton href={`/api/oauth/${p.id}/start?avatarId=${avatarId}`}>
                      <Link2 className="inline h-3 w-3" /> {p.name} で認証して接続
                    </LinkButton>
                  ) : (
                    <Button variant={openForm === p.id ? "ghost" : "primary"} onClick={() => setOpenForm(openForm === p.id ? null : p.id)}>
                      {openForm === p.id ? "閉じる" : "接続情報を入力"}
                    </Button>
                  )}
                </div>
                {openForm === p.id && p.connection === "credentials" && (
                  <>
                    {p.notes.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/50">
                        {p.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                    <ConnectForm
                      p={p}
                      avatarId={avatarId}
                      onDone={(m, ok) => {
                        if (ok) setOpenForm(null);
                        onChanged(m, ok);
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
