"use client";
// 「アカウント」: アバターごとに SNS アカウントを接続し、認証情報（トークン等）を個別に管理する
//   ・接続（OAuth / アプリパスワード / トークン / Cookie）
//   ・アバター専用の開発者アプリ（Client ID / Secret）で共通設定を上書き
//   ・アカウントごとの認証情報の確認（伏せ字）・今すぐ更新・差し替え
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, KeyRound, Link2, RefreshCw, Trash2 } from "lucide-react";
import { api, Badge, Button, Card, CopyText, Field, inputCls, LinkButton, SUPPORT_LABEL, type AccountInfo, type AvatarAppInfo, type PlatformInfo } from "./ui";
import { PlatformIcon } from "@/components/platform-icon";

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

function AvatarAppForm({
  p,
  avatarId,
  avatarName,
  current,
  onDone,
}: {
  p: PlatformInfo;
  avatarId: string;
  avatarName: string;
  current?: AvatarAppInfo;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(p.appFields.map((f) => [f.key, f.type === "password" ? "" : current?.values[f.key] ?? ""]))
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/avatars/${avatarId}/apps/${p.id}`, { method: "PUT", json: values });
      onDone(`${avatarName} 専用の ${p.name} アプリを保存しました。このアバターの新しい接続はこのアプリで認証されます`, true);
    } catch (e) {
      onDone((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`${avatarName} 専用の ${p.name} アプリを解除し、共通アプリに戻しますか？\n専用アプリで接続したアカウントはトークンを更新できなくなるため、再接続が必要です。`)) return;
    setBusy(true);
    try {
      const r = await api<{ affected: number }>(`/api/avatars/${avatarId}/apps/${p.id}`, { method: "DELETE" });
      onDone(`専用アプリを解除しました${r.affected ? `。${r.affected} 件のアカウントを再接続してください` : ""}`, true);
    } catch (e) {
      onDone((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.04] p-4">
      <p className="text-xs text-white/60">
        {avatarName} だけ別の {p.name} 開発者アプリで認証します（ブランドごとにアプリを分けたい・API の利用上限をアプリ単位で分けたい場合）。
        未登録なら「SNS連携アプリ」の共通設定を使います。
      </p>
      {p.redirectUri && (
        <div>
          <div className="mb-1 text-xs text-white/50">リダイレクトURI（専用アプリの開発者ポータルにも登録）</div>
          <CopyText text={p.redirectUri} />
        </div>
      )}
      {p.appFields.map((f) => (
        <Field key={f.key} def={f} value={values[f.key] ?? ""} configured={current?.configured[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "保存中…" : "専用アプリを保存"}
        </Button>
        {current && (
          <Button variant="danger" onClick={remove} disabled={busy}>
            解除（共通アプリに戻す）
          </Button>
        )}
        <span className="text-[11px] text-white/35">秘密の値は暗号化して保存され、画面には表示されません。</span>
      </div>
    </div>
  );
}

interface CredentialInfo {
  connection: "oauth" | "credentials" | "none";
  appScope: "shared" | "avatar";
  scopes: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  hasRefreshToken: boolean;
  canRefresh: boolean;
  fields: { key: string; value: string; secret: boolean }[];
  updatedAt: string;
}

const CRED_LABEL: Record<string, string> = {
  accessToken: "アクセストークン",
  refreshToken: "リフレッシュトークン",
  appPassword: "アプリパスワード",
  password: "パスワード",
  cookie: "Cookie",
  token: "トークン",
  apiKey: "API キー",
  identifier: "ハンドル / メール",
  service: "接続先サーバー",
  siteUrl: "サイトURL",
  username: "ユーザー名",
  userId: "ユーザーID",
  pageId: "ページID",
  authorId: "著者ID",
  repo: "リポジトリ",
  branch: "ブランチ",
};

function CredentialsPanel({ a, p, onChanged }: { a: AccountInfo; p?: PlatformInfo; onChanged: (msg: string, ok: boolean) => void }) {
  const [info, setInfo] = useState<CredentialInfo | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api<CredentialInfo>(`/api/accounts/${a.id}/credentials`));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [a.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      const r = await api<{ expiresAt: string | null }>(`/api/accounts/${a.id}/refresh`, { method: "POST" });
      onChanged(`${a.accountName} のトークンを更新しました${r.expiresAt ? `（期限 ${new Date(r.expiresAt).toLocaleString("ja-JP")}）` : ""}`, true);
      load();
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <p className="mt-3 text-xs text-red-300">{err}</p>;
  if (!info) return <p className="mt-3 text-xs text-white/40">読み込み中…</p>;
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("ja-JP") : "—");
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-white/[0.06] bg-black/30 p-4 text-xs">
      <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
        <div className="text-white/50">
          使用アプリ: <span className="text-white/80">{info.appScope === "avatar" ? "アバター専用アプリ" : info.connection === "oauth" ? "共通アプリ" : "—"}</span>
        </div>
        <div className="text-white/50">
          取得・更新: <span className="text-white/80">{fmt(info.issuedAt)}</span>
        </div>
        <div className="text-white/50">
          有効期限: <span className="text-white/80">{fmt(info.expiresAt)}</span>
        </div>
        <div className="text-white/50">
          自動更新:{" "}
          <span className="text-white/80">
            {info.canRefresh
              ? info.hasRefreshToken || info.connection !== "oauth"
                ? "あり（投稿前に期限が近ければ更新）"
                : "リフレッシュトークンなし（期限切れ前に再認証）"
              : info.connection === "oauth"
                ? "非対応（期限切れ前に再認証）"
                : "不要（投稿時に保存した情報でログイン）"}
          </span>
        </div>
        {info.scopes && (
          <div className="break-all text-white/50 md:col-span-2">
            権限（スコープ）: <span className="text-white/80">{info.scopes}</span>
          </div>
        )}
      </div>
      {info.fields.length > 0 && (
        <div className="space-y-1">
          {info.fields.map((f) => (
            <div key={f.key} className="flex gap-2">
              <span className="w-40 shrink-0 text-white/50">{CRED_LABEL[f.key] ?? f.key}</span>
              <code className={`break-all ${f.secret ? "text-white/50" : "text-white/80"}`}>{f.value}</code>
            </div>
          ))}
          <p className="text-[11px] text-white/30">トークン・パスワード・Cookie などの秘密の値は暗号化して保存され、画面には伏せ字でのみ表示します。</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {info.canRefresh && (
          <Button variant="ghost" onClick={refresh} disabled={busy}>
            <RefreshCw className="inline h-3 w-3" /> {busy ? "更新中…" : "今すぐトークンを更新"}
          </Button>
        )}
        {p?.connection === "oauth" && (
          <LinkButton variant="ghost" href={`/api/oauth/${a.platform}/start?avatarId=${a.avatarId}`}>
            再認証して取り直す
          </LinkButton>
        )}
        {p?.connection === "credentials" && (
          <Button variant="ghost" onClick={() => setReplace(!replace)}>
            {replace ? "閉じる" : "認証情報を差し替え"}
          </Button>
        )}
      </div>
      {replace && p && (
        <>
          <p className="text-[11px] text-white/40">同じアカウントの情報を入力すると、このアカウントの認証情報が置き換わります（別アカウントを入力すると新しい接続として追加されます）。</p>
          <ConnectForm
            p={p}
            avatarId={a.avatarId}
            onDone={(m, ok) => {
              if (ok) setReplace(false);
              onChanged(m, ok);
            }}
          />
        </>
      )}
    </div>
  );
}

function AccountRow({ a, p, onChanged }: { a: AccountInfo; p?: PlatformInfo; onChanged: (msg: string, ok: boolean) => void }) {
  const [settings, setSettings] = useState<Record<string, string>>(() =>
    Object.fromEntries((p?.settingFields ?? []).map((f) => [f.key, String(a.settings[f.key] ?? f.default ?? "")]))
  );
  const [busy, setBusy] = useState(false);
  const [showCred, setShowCred] = useState(false);
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
        <PlatformIcon platform={a.platform} />
        <span className="text-sm font-semibold">{a.accountName}</span>
        <span className="text-xs text-white/40">{p?.name}</span>
        {a.profileUrl && (
          <a href={a.profileUrl} target="_blank" rel="noreferrer" className="text-white/30 hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <span className="flex-1" />
        {a.appScope === "avatar" && <Badge className="bg-violet-500/15 text-violet-300">専用アプリ</Badge>}
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
        <Button variant="ghost" onClick={() => setShowCred(!showCred)}>
          <KeyRound className="inline h-3 w-3" /> {showCred ? "認証情報を閉じる" : "認証情報"}
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
      {showCred && <CredentialsPanel a={a} p={p} onChanged={onChanged} />}
    </div>
  );
}

export function AccountsSection({
  platforms,
  accounts,
  avatars,
  avatarApps,
  onChanged,
}: {
  platforms: PlatformInfo[];
  accounts: AccountInfo[];
  avatars: { id: string; name: string }[];
  avatarApps: AvatarAppInfo[];
  onChanged: (msg: string, ok: boolean) => void;
}) {
  const [avatarId, setAvatarId] = useState(avatars[0]?.id ?? "");
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [openApp, setOpenApp] = useState<string | null>(null);
  const avatarName = avatars.find((a) => a.id === avatarId)?.name ?? "";
  const ownApps = Object.fromEntries(avatarApps.filter((x) => x.avatarId === avatarId).map((x) => [x.platform, x]));
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
            const own = ownApps[p.id];
            const appMissing = p.appFields.length > 0 && !p.app?.complete && !own?.complete;
            return (
              <div key={p.id} className="rounded-xl border border-white/[0.06] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PlatformIcon platform={p.id} />
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge className={SUPPORT_LABEL[p.support].cls}>{SUPPORT_LABEL[p.support].label}</Badge>
                  {p.appFields.length > 0 &&
                    (own ? <Badge className="bg-violet-500/15 text-violet-300">専用アプリ</Badge> : p.app?.complete ? <Badge className="bg-white/5 text-white/40">共通アプリ</Badge> : null)}
                  {p.appFields.length > 0 && (
                    <button onClick={() => setOpenApp(openApp === p.id ? null : p.id)} className="text-[11px] text-violet-300 hover:underline">
                      {openApp === p.id ? "閉じる" : own ? "専用アプリを編集" : "このアバター専用のアプリを使う"}
                    </button>
                  )}
                  <span className="flex-1" />
                  {p.connection === "none" ? (
                    <span className="text-xs text-white/40">{p.notes[0]}</span>
                  ) : appMissing ? (
                    <span className="text-xs text-amber-300">先に「SNS連携アプリ」または専用アプリを登録してください</span>
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
                {openApp === p.id && (
                  <AvatarAppForm
                    key={`${avatarId}:${p.id}:${own ? "own" : "none"}`}
                    p={p}
                    avatarId={avatarId}
                    avatarName={avatarName}
                    current={own}
                    onDone={(m, ok) => {
                      if (ok) setOpenApp(null);
                      onChanged(m, ok);
                    }}
                  />
                )}
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
