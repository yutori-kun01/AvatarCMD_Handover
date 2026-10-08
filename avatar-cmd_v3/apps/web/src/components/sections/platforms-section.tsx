"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Embedded, Shell, Stat } from "@/components/dashboard/shell";
import { api, Card, DocLinks, Notice, SupportBadge, type AccountInfo, type PlatformInfo } from "@/components/settings/ui";
import { PlatformIcon } from "@/components/platform-icon";

/** 対応プラットフォームの一覧と接続状況（設定 > プラットフォーム） */
function PlatformsSectionInner() {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ platforms: PlatformInfo[]; accounts: AccountInfo[] }>("/api/integrations")
      .then((d) => {
        setPlatforms(d.platforms);
        setAccounts(d.accounts);
      })
      .catch((e) => setErr(e.message));
    api<{ platforms: { platform: string; count: number }[] }>("/api/stats")
      .then((d) => setCounts(Object.fromEntries(d.platforms.map((p) => [p.platform, p.count]))))
      .catch(() => {});
  }, []);

  const auto = platforms.filter((p) => p.support !== "manual" && !p.comingSoon);
  const connected = new Set(accounts.map((a) => a.platform));

  return (
    <Shell title="SNS運用" description="プラットフォームごとの接続・投稿状況" wide>
      {err && <Notice kind="error">{err}</Notice>}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="自動投稿に対応" value={`${auto.length} / ${platforms.length}`} />
        <Stat label="接続済みプラットフォーム" value={connected.size} tone="text-cyan-300" />
        <Stat label="接続アカウント" value={accounts.length} />
        <Stat label="30日の投稿" value={Object.values(counts).reduce((a, b) => a + b, 0)} tone="text-emerald-300" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {platforms.map((p) => {
          const accs = accounts.filter((a) => a.platform === p.id);
          const appMissing = p.appFields.length > 0 && !p.app?.complete;
          if (p.comingSoon) {
            return (
              <Card key={p.id} className="opacity-60">
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={p.id} className="text-lg" />
                  <span className="flex-1 font-semibold">{p.name}</span>
                  <SupportBadge p={p} />
                </div>
                <p className="mt-3 text-xs text-white/50">準備中です。今後のアップデートで対応予定です。</p>
              </Card>
            );
          }
          return (
            <Card key={p.id} className={p.support === "manual" ? "opacity-60" : ""}>
              <div className="flex items-center gap-2">
                <PlatformIcon platform={p.id} className="text-lg" />
                <span className="flex-1 font-semibold">{p.name}</span>
                <SupportBadge p={p} />
              </div>
              <div className="mt-3 space-y-1 text-xs text-white/60">
                {p.support === "manual" ? (
                  <p>{p.notes[0]}</p>
                ) : (
                  <>
                    <p>
                      接続: {accs.length ? accs.map((a) => a.accountName).join("、") : <span className="text-white/35">なし</span>}
                    </p>
                    <p>30日の投稿: {counts[p.id] ?? 0}件</p>
                    <p>
                      添付: {[p.media.image && "画像", p.media.video && "動画"].filter(Boolean).join("・") || "なし"}
                      {p.maxLength ? ` / 最大${p.maxLength.toLocaleString()}文字` : ""}
                    </p>
                    {appMissing && <p className="text-amber-300">開発者アプリ未登録</p>}
                  </>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                {p.support !== "manual" && (
                  <Link href={appMissing ? "/settings?tab=apps" : "/settings?tab=accounts"} className="text-cyan-300">
                    {appMissing ? "アプリを登録 →" : "アカウント管理 →"}
                  </Link>
                )}
              </div>
              <div className="mt-2">
                <DocLinks docs={p.docs.slice(0, 1)} />
              </div>
            </Card>
          );
        })}
      </div>
    </Shell>
  );
}

/** 別の画面のタブとして表示する */
export function PlatformsSection() {
  return (
    <Embedded>
      <PlatformsSectionInner />
    </Embedded>
  );
}
