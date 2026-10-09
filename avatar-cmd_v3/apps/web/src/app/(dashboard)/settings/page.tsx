"use client";
// 設定 — カテゴリ（SNS 投稿・記事執筆・画像・動画・AI 共通・システム）をトグルで開閉し、その中の項目を選ぶ
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Clapperboard, Cpu, FileText, Image as ImageIcon, Send, Settings2 } from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { api, Notice, type AccountInfo, type AvatarAppInfo, type PlatformInfo } from "@/components/settings/ui";
import { AppsSection } from "@/components/settings/apps-section";
import { AccountsSection } from "@/components/settings/accounts-section";
import { ApiKeysSection } from "@/components/settings/api-keys-section";
import { AiKeysSection, AiTasksSection, JevSection, SecuritySection, SystemBasicsSection, type AiInfo, type JevInfo, type SystemInfo } from "@/components/settings/system-section";
import { ImageSection } from "@/components/settings/image-section";
import { VideoAssetsSection, VideoSettingsSection } from "@/components/settings/video-section";
import { PlatformsSection } from "@/components/sections/platforms-section";
import { CostsSection } from "@/components/sections/costs-section";

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

/** 用途ごとの AI の割り当て（カテゴリごとに分けて表示） */
const AI_TASK_GROUPS: Record<string, { title: string; description: string; tasks: string[] }> = {
  "ai-post": { title: "投稿文の AI", description: "SNS 投稿文の生成・文字数調整・投稿前チェック・引用投稿・タグ提案に使う AI です。", tasks: ["post", "rewrite", "review", "quote", "tags"] },
  "ai-article": { title: "記事執筆の AI", description: "WordPress / Zenn / note / Medium 向けの長文記事と、見出しごとの画像・図解の設計に使う AI です。", tasks: ["article", "visual"] },
  "ai-image": { title: "画像の AI", description: "アバターの参考画像からスタイル定義を作る AI です（画像を読めるモデルが必要）。", tasks: ["style"] },
  "ai-video": { title: "動画の AI", description: "動画パイプラインのネタ候補・台本とカット指示書・検品の精査に使う AI です。", tasks: ["video_topics", "video_script", "video_qc"] },
  "ai-learning": { title: "学習・改善の AI", description: "YouTube 動画・RSS 記事の要約と、定期的な改善分析に使う AI です。", tasks: ["summary", "improvement"] },
};

interface NavItem {
  key: string;
  label: string;
  /** 画面を広く使う項目 */
  wide?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  icon: typeof Send;
  items: NavItem[];
}

// 以前のタブ（accounts / platforms / apps / system / images / costs / security / api）のキーはそのまま使う（既存のリンクを壊さない）
const GROUPS: NavGroup[] = [
  {
    id: "sns",
    label: "SNS 投稿",
    icon: Send,
    items: [
      { key: "accounts", label: "アカウント" },
      { key: "apps", label: "SNS連携アプリ" },
      { key: "platforms", label: "プラットフォーム", wide: true },
      { key: "ai-post", label: "投稿文の AI" },
    ],
  },
  { id: "article", label: "記事執筆", icon: FileText, items: [{ key: "ai-article", label: "記事執筆の AI" }] },
  {
    id: "image",
    label: "画像",
    icon: ImageIcon,
    items: [
      { key: "images", label: "画像生成" },
      { key: "ai-image", label: "画像の AI" },
    ],
  },
  {
    id: "video",
    label: "動画",
    icon: Clapperboard,
    items: [
      { key: "video", label: "パイプライン設定" },
      { key: "video-assets", label: "固定アセット" },
      { key: "ai-video", label: "動画の AI" },
    ],
  },
  {
    id: "ai",
    label: "AI 共通・判定",
    icon: Cpu,
    items: [
      { key: "ai-keys", label: "API キー" },
      { key: "jev", label: "判定（Jev）" },
      { key: "ai-learning", label: "学習・改善の AI" },
    ],
  },
  {
    id: "system",
    label: "システム",
    icon: Settings2,
    items: [
      { key: "system", label: "基本設定" },
      { key: "costs", label: "API コスト", wide: true },
      { key: "api", label: "外部AI API" },
      { key: "security", label: "セキュリティ" },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g })));
const OPEN_KEY = "settings-open-groups";

function readOpen(): string[] | null {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab") || "accounts";
  const current = ALL_ITEMS.find((i) => i.key === requested) ?? ALL_ITEMS[0];
  const tab = current.key;
  const [open, setOpen] = useState<string[]>([current.group.id]);
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

  // 開いているカテゴリは覚えておく（選んだ項目のカテゴリは必ず開く）
  useEffect(() => {
    const saved = readOpen();
    setOpen((cur) => [...new Set([...(saved ?? []), ...cur, current.group.id])]);
  }, [current.group.id]);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* 保存できなくても開閉はできる */
      }
      return next;
    });

  // OAuth コールバックからの戻り
  useEffect(() => {
    const c = params.get("connected");
    const e = params.get("error");
    if (c) setNotice({ kind: "ok", msg: `接続しました: ${c}` });
    if (e) setNotice({ kind: "error", msg: e });
  }, [params]);

  const onChanged = useCallback(
    (msg: string, ok: boolean) => {
      setNotice({ kind: ok ? "ok" : "error", msg });
      if (ok) load();
    },
    [load]
  );

  const aiGroup = AI_TASK_GROUPS[tab];

  return (
    <div className="flex min-h-screen bg-[#0b0c0f] text-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title="設定" description="SNS 投稿・記事執筆・画像・動画・AI・システムの設定" />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
            <nav className="space-y-1 md:sticky md:top-4 md:self-start" aria-label="設定のカテゴリ">
              {GROUPS.map((g) => {
                const isOpen = open.includes(g.id);
                const Icon = g.icon;
                const active = g.id === current.group.id;
                return (
                  <div key={g.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
                    <button
                      onClick={() => toggle(g.id)}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-white/[0.04] ${active ? "text-white" : "text-white/70"}`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-white/50" />
                      <span className="flex-1">{g.label}</span>
                      {isOpen ? <ChevronDown className="h-4 w-4 text-white/40" /> : <ChevronRight className="h-4 w-4 text-white/40" />}
                    </button>
                    {isOpen && (
                      <div className="space-y-0.5 px-2 pb-2">
                        {g.items.map((i) => (
                          <button
                            key={i.key}
                            onClick={() => router.replace(`/settings?tab=${i.key}`)}
                            className={`block w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition ${
                              tab === i.key ? "bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] font-semibold text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white"
                            }`}
                          >
                            {i.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>

            <section className={`min-w-0 ${current.wide ? "" : "max-w-4xl"}`}>
              <div className="mb-4">
                <div className="text-[11px] text-white/40">{current.group.label}</div>
                <h2 className="text-lg font-semibold">{current.label}</h2>
              </div>
              {notice && (
                <Notice kind={notice.kind} onClose={() => setNotice(null)}>
                  {notice.msg}
                </Notice>
              )}
              {loadError && <Notice kind="error">設定を読み込めませんでした: {loadError}</Notice>}
              {!data && !loadError && !["platforms", "costs", "video"].includes(tab) && <p className="text-sm text-white/40">読み込み中…</p>}
              {data && tab === "accounts" && (
                <AccountsSection platforms={data.platforms} accounts={data.accounts} avatars={data.avatars} avatarApps={data.avatarApps} onChanged={onChanged} />
              )}
              {data && tab === "apps" && <AppsSection platforms={data.platforms} onChanged={onChanged} />}
              {tab === "platforms" && <PlatformsSection />}
              {data && tab === "system" && <SystemBasicsSection system={data.system} onChanged={onChanged} />}
              {data && tab === "ai-keys" && <AiKeysSection ai={data.ai} onChanged={onChanged} />}
              {data && tab === "jev" && <JevSection jev={data.jev} onChanged={onChanged} />}
              {data && aiGroup && <AiTasksSection key={tab} ai={data.ai} taskIds={aiGroup.tasks} title={aiGroup.title} description={aiGroup.description} onChanged={onChanged} />}
              {data && tab === "images" && <ImageSection avatars={data.avatars} onChanged={onChanged} />}
              {tab === "video" && <VideoSettingsSection onChanged={onChanged} />}
              {data && tab === "video-assets" && <VideoAssetsSection avatars={data.avatars} onChanged={onChanged} />}
              {tab === "costs" && <CostsSection />}
              {data && tab === "security" && <SecuritySection encryptionReady={data.encryptionReady} onChanged={onChanged} />}
              {data && tab === "api" && <ApiKeysSection avatars={data.avatars} onChanged={onChanged} />}
            </section>
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
