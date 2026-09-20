"use client";
import { useApiData } from "@/hooks/use-api";
import {
  Panel,
  Notice,
  api,
  useAction,
  field,
  button,
  primary,
  date,
  type Avatar,
} from "@/components/dashboard/live-ui";
type Settings = {
  role: string;
  aiConfigured: boolean;
  encryptionConfigured: boolean;
  timezone: string;
  accounts: {
    id: string;
    avatar: { name: string };
    accountName: string;
    accountId: string | null;
    platform: string;
    isActive: boolean;
    tokenExpiry: string | null;
    lastError: string | null;
  }[];
};
export default function SettingsPage() {
  const settings = useApiData<Settings>("/api/settings");
  const avatars = useApiData<Avatar[]>("/api/avatars");
  const action = useAction();
  return (
    <div className="space-y-5">
      <Notice
        error={settings.error || avatars.error}
        loading={settings.loading}
      />
      {action.feedback}
      <Panel title="システム設定">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-muted-foreground">AI生成</dt>
          <dd>
            {settings.data
              ? settings.data.aiConfigured
                ? "設定済み"
                : "未設定"
              : "確認中"}
          </dd>
          <dt className="text-muted-foreground">認証情報の暗号化</dt>
          <dd>
            {settings.data
              ? settings.data.encryptionConfigured
                ? "設定済み"
                : "未設定"
              : "確認中"}
          </dd>
          <dt className="text-muted-foreground">定期実行の時刻</dt>
          <dd>日本時間（Asia/Tokyo）</dd>
        </dl>
        <p className="text-sm text-muted-foreground">
          AIの接続情報はサーバーのGEMINI_API_KEYに設定します。設定済みの表示は、APIへの接続成功を保証するものではありません。
        </p>
      </Panel>
      <Panel title="SNS接続">
        <p className="text-sm text-muted-foreground">
          アバターごとに投稿先を登録します。同じSNSを登録し直すと、以前の投稿先は無効になります。トークンは暗号化して保存し、画面には再表示しません。
        </p>
        {!settings.loading && !settings.data?.accounts.length && (
          <p className="text-sm text-muted-foreground">
            接続情報はまだ登録されていません。
          </p>
        )}
        {settings.data?.accounts.map((a) => (
          <article
            key={a.id}
            className="border border-white/10 rounded-lg p-4 space-y-2"
          >
            <div className="flex justify-between gap-3">
              <div>
                <p>
                  {a.avatar.name} / {a.platform} / {a.accountName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.isActive ? "登録済み（接続未検証）" : "無効"} ·
                  アカウントID {a.accountId || "未登録"} · 有効期限{" "}
                  {date(a.tokenExpiry)}
                </p>
              </div>
              {a.isActive && (
                <button
                  className={button}
                  disabled={action.busy}
                  onClick={() => {
                    if (
                      confirm("接続を解除し、保存済みトークンを削除しますか？")
                    )
                      void action.run(async () => {
                        await api("/api/accounts", "DELETE", { id: a.id });
                        await settings.refetch();
                      }, "接続を解除しました");
                  }}
                >
                  解除
                </button>
              )}
            </div>
            {a.lastError && <Notice error={a.lastError} />}
          </article>
        ))}
      </Panel>
      <Panel title="X・Threadsの接続情報を登録">
        <form
          className="grid gap-3 md:grid-cols-2"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = Object.fromEntries(new FormData(form));
            void action.run(async () => {
              await api("/api/accounts", "POST", {
                ...f,
                tokenExpiry: f.tokenExpiry
                  ? new Date(String(f.tokenExpiry)).toISOString()
                  : null,
              });
              form.reset();
              await settings.refetch();
            }, "接続情報を保存しました。投稿前にテスト用アカウントで確認してください。");
          }}
        >
          <label className="text-sm">
            アバター
            <select className={field} name="avatarId" required>
              <option value="">選択してください</option>
              {avatars.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            SNS
            <select className={field} name="platform">
              <option value="x">X</option>
              <option value="threads">Threads</option>
            </select>
          </label>
          <label className="text-sm">
            アカウント名
            <input
              className={field}
              name="accountName"
              required
              maxLength={200}
            />
          </label>
          <label className="text-sm">
            SNSアカウントID（任意）
            <input className={field} name="accountId" maxLength={200} />
          </label>
          <label className="text-sm">
            アクセストークン
            <input
              type="password"
              autoComplete="new-password"
              className={field}
              name="accessToken"
              required
              maxLength={8192}
            />
          </label>
          <label className="text-sm">
            更新用トークン（任意）
            <input
              type="password"
              autoComplete="new-password"
              className={field}
              name="refreshToken"
              maxLength={8192}
            />
          </label>
          <label className="text-sm">
            有効期限（任意・端末の現地時間）
            <input type="datetime-local" className={field} name="tokenExpiry" />
          </label>
          <div className="flex items-end">
            <button
              className={primary}
              disabled={
                action.busy ||
                !settings.data?.encryptionConfigured ||
                !avatars.data?.length
              }
            >
              暗号化して保存
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
