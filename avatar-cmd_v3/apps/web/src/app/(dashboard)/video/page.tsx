"use client";
// 動画 — 動画パイプラインのエピソード一覧・新規作成・工程ごとの承認（docs/VIDEO_PIPELINE.md）
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { api, Badge, Button, Card, inputCls, Notice } from "@/components/settings/ui";
import { EpisodeDetail } from "@/components/video/episode-detail";
import { TARGET_LABEL, type EpisodeSummary, type ProfileInfo } from "@/components/video/types";

function NewEpisode({ avatars, profiles, onCreated }: { avatars: { id: string; name: string }[]; profiles: Record<string, ProfileInfo>; onCreated: (id: string) => void }) {
  const [avatarId, setAvatarId] = useState(avatars[0]?.id ?? "");
  const [profile, setProfile] = useState("long_with_clips");
  const p = profiles[profile];
  const [targets, setTargets] = useState<string[]>(p?.defaultTargets ?? []);
  const [theme, setTheme] = useState("");
  const [minutes, setMinutes] = useState(String(p?.minutes.default ?? 15));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!avatarId && avatars[0]) setAvatarId(avatars[0].id);
  }, [avatars, avatarId]);

  const changeProfile = (id: string) => {
    setProfile(id);
    setTargets(profiles[id]?.defaultTargets ?? []);
    setMinutes(String(profiles[id]?.minutes.default ?? 1));
  };

  async function create() {
    setBusy(true);
    setError("");
    try {
      const d = await api<{ episode: { id: string } }>("/api/video/episodes", { method: "POST", json: { avatarId, profile, targets, theme, targetMinutes: Number(minutes) } });
      onCreated(d.episode.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">新しい動画</h3>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-white/60">アバター（チャンネル）</span>
          <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className={inputCls}>
            {avatars.map((a) => (
              <option key={a.id} value={a.id} className="bg-[#111]">
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-white/60">フォーマット</span>
          <select value={profile} onChange={(e) => changeProfile(e.target.value)} className={inputCls}>
            {Object.values(profiles).map((x) => (
              <option key={x.id} value={x.id} className="bg-[#111]">
                {x.label}
              </option>
            ))}
          </select>
          {p && <span className="mt-1 block text-[11px] text-white/35">{p.help}</span>}
        </label>
      </div>
      {p && (
        <div className="flex flex-wrap gap-3">
          {p.targets.map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-xs text-white/70">
              <input type="checkbox" checked={targets.includes(t)} onChange={(e) => setTargets(e.target.checked ? [...targets, t] : targets.filter((x) => x !== t))} />
              {TARGET_LABEL[t] ?? t}
            </label>
          ))}
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-xs text-white/60">{profile === "ad" ? "依頼内容（商品・訴求・ターゲット・NG 表現）" : "ジャンル・テーマ（任意）"}</span>
        <textarea value={theme} onChange={(e) => setTheme(e.target.value)} rows={3} className={inputCls} placeholder={profile === "ad" ? "例: 折りたたみ傘の新商品。軽さと耐風性を訴求、通勤中の会社員向け" : "例: 都市伝説・未解決事件の解説"} />
      </label>
      <label className="block max-w-[12rem]">
        <span className="mb-1 block text-xs text-white/60">長さの目安（分）</span>
        <input type="number" step="0.25" min={p?.minutes.min} max={p?.minutes.max} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputCls} />
      </label>
      <Button disabled={busy || !avatarId || !targets.length || (profile === "ad" && !theme.trim())} onClick={create}>
        {busy ? "作成中…" : profile === "ad" ? "作成して台本を書く" : "作成してネタ候補を出す"}
      </Button>
    </Card>
  );
}

function VideoInner() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("id");
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [avatars, setAvatars] = useState<{ id: string; name: string }[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileInfo>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ episodes: EpisodeSummary[] }>("/api/video/episodes");
      setEpisodes(d.episodes);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    api<{ avatars: { id: string; name: string }[] }>("/api/avatars")
      .then((d) => setAvatars(d.avatars))
      .catch(() => setAvatars([]));
    api<{ profiles: Record<string, ProfileInfo> }>("/api/video/settings")
      .then((d) => setProfiles(d.profiles))
      .catch(() => setProfiles({}));
  }, [load]);

  const waiting = episodes.filter((e) => e.gate && e.status === "active").length;

  return (
    <div className="flex min-h-screen bg-[#0b0c0f] text-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title="動画" description="企画 → 台本 → 絵コンテ → 本番 → 書き出し → 予約投稿（承認 A〜D は人が行います）" />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">
                  エピソード
                  {waiting > 0 && <Badge className="ml-2 bg-amber-500/15 text-amber-300">承認待ち {waiting}</Badge>}
                </div>
                <Button
                  onClick={() => {
                    setCreating(true);
                    router.replace("/video");
                  }}
                >
                  <Plus className="mr-1 inline h-3 w-3" />
                  新規
                </Button>
              </div>
              {error && <Notice kind="error">{error}</Notice>}
              <div className="space-y-1.5">
                {episodes.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setCreating(false);
                      router.replace(`/video?id=${e.id}`);
                    }}
                    className={`block w-full rounded-xl border p-3 text-left transition ${selected === e.id ? "border-cyan-400/50 bg-cyan-500/[0.06]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"}`}
                  >
                    <div className="truncate text-sm font-semibold">{e.title || "（タイトル未定）"}</div>
                    <div className="mt-0.5 truncate text-[11px] text-white/40">
                      {e.episodeKey} ・ {e.avatarName}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge className={e.gate && e.status === "active" ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-white/60"}>{e.stageLabel}</Badge>
                      {e.status !== "active" && <Badge className="bg-white/10 text-white/50">{e.status === "paused" ? "一時停止" : e.status === "done" ? "完了" : "中止"}</Badge>}
                      {e.report && e.status !== "done" && <Badge className="bg-red-500/15 text-red-300">報告あり</Badge>}
                    </div>
                  </button>
                ))}
                {!episodes.length && <p className="text-xs text-white/40">まだエピソードがありません。</p>}
              </div>
              <p className="text-[11px] text-white/35">
                上限値・画像生成・ナレーション・固定アセットは{" "}
                <Link href="/settings?tab=video" className="text-cyan-300 underline">
                  設定 &gt; 動画
                </Link>
              </p>
            </div>
            <div className="min-w-0">
              {creating || !selected ? (
                <NewEpisode
                  avatars={avatars}
                  profiles={profiles}
                  onCreated={(id) => {
                    setCreating(false);
                    load();
                    router.replace(`/video?id=${id}`);
                  }}
                />
              ) : (
                <EpisodeDetail key={selected} id={selected} onChanged={load} />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function VideoPage() {
  return (
    <Suspense>
      <VideoInner />
    </Suspense>
  );
}
