"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { api, Notice, type AccountInfo, type AvatarAppInfo, type PlatformInfo } from "@/components/settings/ui";
import { AppsSection } from "@/components/settings/apps-section";
import { AccountsSection } from "@/components/settings/accounts-section";
import { SecuritySection, SystemSection, type AiInfo, type JevInfo, type SystemInfo } from "@/components/settings/system-section";

interface Data {
  system: SystemInfo;
  ai: AiInfo;
  jev: JevInfo;
  platforms: PlatformInfo[];
  avatars: { id: string; name: string }[];
  accounts: AccountInfo[];
  avatarApps: AvatarAppInfo[];
  encryptionReady: boolean;
}

const TABS = [
  { key: "accounts", label: "アカウント" },
  { key: "apps", label: "SNS連携アプリ" },
  { key: "system", label: "システム" },
  { key: "security", label: "セキュリティ" },
] as const;

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as (typeof TABS)[number]["key"]) || "accounts";
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/integrations"));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // OAuth コールバックからの戻り
  useEffect(() => {
    const c = params.get("connected");
    const e = params.get("error");
    if (c) setNotice({ kind: "ok", msg: `接続しました: ${c}` });
    if (e) setNotice({ kind: "error", msg: e });
  }, [params]);

  const onChanged = (msg: string, ok: boolean) => {
    setNotice({ kind: ok ? "ok" : "error", msg });
    if (ok) load();
  };

  return (
    <div className="flex min-h-screen bg-[#0b0c0f] text-white">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header title="設定" description="SNS連携・アカウント・システム設定" />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5 flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => router.replace(`/settings?tab=${t.key}`)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    tab === t.key ? "bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6]" : "bg-white/[0.05] text-white/60 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {notice && (
              <Notice kind={notice.kind} onClose={() => setNotice(null)}>
                {notice.msg}
              </Notice>
            )}
            {loadError && <Notice kind="error">設定を読み込めませんでした: {loadError}</Notice>}
            {!data && !loadError && <p className="text-sm text-white/40">読み込み中…</p>}
            {data && tab === "accounts" && (
              <AccountsSection platforms={data.platforms} accounts={data.accounts} avatars={data.avatars} avatarApps={data.avatarApps} onChanged={onChanged} />
            )}
            {data && tab === "apps" && <AppsSection platforms={data.platforms} onChanged={onChanged} />}
            {data && tab === "system" && <SystemSection system={data.system} ai={data.ai} jev={data.jev} onChanged={onChanged} />}
            {data && tab === "security" && <SecuritySection encryptionReady={data.encryptionReady} onChanged={onChanged} />}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
