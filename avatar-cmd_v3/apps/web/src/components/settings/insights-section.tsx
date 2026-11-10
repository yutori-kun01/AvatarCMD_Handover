"use client";
// 設定 > AI 共通・判定 > プラットフォームの傾向: 全アバター横断の「どんな構成が伸びるか」（運用側のノウハウ。エクスポートには含めない）
import { useCallback, useEffect, useState } from "react";
import { api, Badge, Button, Card, inputCls } from "./ui";

type OnChanged = (msg: string, ok: boolean) => void;

interface InsightRow {
  id: string;
  platform: string;
  genre: string;
  feature: string;
  groupLabel: string;
  label: string;
  lift: number;
  agree: number;
  avatars: number;
  clients: number;
  posts: number;
}

interface Option {
  value: string;
  label: string;
}

interface Data {
  insights: InsightRow[];
  mode: "on" | "off";
  computedAt: string | null;
  rules: { windowDays: number; minBaselinePosts: number; minFeaturePosts: number; minAvatars: number; playbook: { minLift: number; minAgree: number; maxHints: number; groups: string[] } };
  platforms: Option[];
  genres: Option[];
  avatarsByGenre: { genre: string | null; count: number }[];
}

const liftCls = (lift: number) => (lift >= 1.15 ? "text-emerald-300" : lift <= 0.87 ? "text-red-300" : "text-white/70");

export function InsightsSection({ onChanged }: { onChanged: OnChanged }) {
  const [d, setD] = useState<Data | null>(null);
  const [platform, setPlatform] = useState("");
  const [genre, setGenre] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const query = useCallback(() => `/api/settings/insights?${new URLSearchParams({ ...(platform ? { platform } : {}), ...(genre ? { genre } : {}) })}`, [platform, genre]);

  useEffect(() => {
    api<Data>(query())
      .then(setD)
      .catch((e) => onChanged((e as Error).message, false));
  }, [query, onChanged]);

  if (!d) return <p className="text-sm text-white/40">読み込み中…</p>;

  async function recompute() {
    setBusy("recompute");
    try {
      const r = await api<Data & { result: { insights: number; posts: number } }>(query(), { method: "POST" });
      setD(r);
      onChanged(`集計しました（対象の投稿 ${r.result.posts} 件 → 傾向 ${r.result.insights} 件）`, true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  async function setMode(mode: "on" | "off") {
    setBusy("mode");
    try {
      setD(await api<Data>(query(), { method: "PUT", json: { mode } }));
      onChanged(mode === "on" ? "傾向を投稿の生成に使います" : "傾向を投稿の生成に使わないようにしました", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  const genreName = (g: string | null) => (g ? d.genres.find((o) => o.value === g)?.label ?? g : "判定待ち");
  const platformName = (p: string) => d.platforms.find((o) => o.value === p)?.label ?? p;
  const r = d.rules;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm text-white/70">
          全アバターの投稿を横断して、プラットフォーム × ジャンルごとに「どんな構成の投稿が、そのアバターの普段より伸びたか」を集計します。
          運用側のノウハウとして扱い、<span className="font-semibold text-white">アバターのエクスポートには含めません</span>。
        </p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-white/50">
          <li>
            直近 {r.windowDays} 日の公開済み投稿のうち、指標が出そろったものを使います。アバター × プラットフォームごとに {r.minBaselinePosts} 件以上の投稿が必要です。
          </li>
          <li>表示回数と反応率を、それぞれのアバターの普段（中央値）と比べます。1.00 が普段どおり、1.20 なら普段の 1.2 倍です。</li>
          <li>アバター 1 体を 1 票として数え、{r.minAvatars} 体以上で集計できた値だけを表示します。保存するのは数値だけで、投稿の本文は保存しません。</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={recompute} disabled={!!busy}>
            {busy === "recompute" ? "集計中…" : "今すぐ集計"}
          </Button>
          <span className="text-[11px] text-white/40">最終集計: {d.computedAt ? new Date(d.computedAt).toLocaleString("ja-JP") : "まだありません"}（worker が 1 日 1 回集計します）</span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-white/50">
          <span>アバターのジャンル:</span>
          {d.avatarsByGenre.map((g) => (
            <Badge key={g.genre ?? "none"} className="bg-white/[0.06] text-white/60">
              {genreName(g.genre)} {g.count}
            </Badge>
          ))}
        </div>
      </Card>

      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold">投稿の生成に使う</h3>
          <Badge className={d.mode === "on" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/50"}>{d.mode === "on" ? "オン" : "オフ"}</Badge>
          <span className="flex-1" />
          <Button variant={d.mode === "on" ? "ghost" : "primary"} disabled={!!busy} onClick={() => setMode(d.mode === "on" ? "off" : "on")}>
            {d.mode === "on" ? "オフにする" : "オンにする"}
          </Button>
        </div>
        <p className="text-xs text-white/50">
          オンにすると、投稿・note 記事の生成で、そのアバターのジャンル（無ければ全ジャンル）の傾向のうち、{r.playbook.minLift.toFixed(2)} 倍以上かつ
          {Math.round(r.playbook.minAgree * 100)}% 以上のアバターで良かったものを、分類ごとに 1 つ・最大 {r.playbook.maxHints} つまで AI に参考として渡します。
          口調・主張・事実は変えないよう指示します。時間帯とリンクは本文の書き方では決まらない（リンクは AI に作らせると誤った URL になりうる）ため渡しません。
          傾向はアバターのナレッジにはコピーせず、生成のたびにこの表から読みます。
        </p>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={`${inputCls} !w-auto`}>
            <option value="" className="bg-[#111]">
              すべてのプラットフォーム
            </option>
            {d.platforms.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#111]">
                {o.label}
              </option>
            ))}
          </select>
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className={`${inputCls} !w-auto`}>
            {d.genres.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#111]">
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {d.insights.length === 0 ? (
          <p className="text-xs text-white/40">
            まだ傾向がありません。{r.minAvatars} 体以上のアバターで、同じプラットフォームに {r.minBaselinePosts} 件以上の指標が出そろった投稿がたまると表示されます。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-white/40">
                <tr className="border-b border-white/[0.06]">
                  <th className="py-2 pr-3 font-normal">プラットフォーム</th>
                  <th className="py-2 pr-3 font-normal">ジャンル</th>
                  <th className="py-2 pr-3 font-normal">分類</th>
                  <th className="py-2 pr-3 font-normal">構成</th>
                  <th className="py-2 pr-3 text-right font-normal">普段比</th>
                  <th className="py-2 pr-3 text-right font-normal">良かったアバター</th>
                  <th className="py-2 pr-3 text-right font-normal">アバター / クライアント</th>
                  <th className="py-2 text-right font-normal">投稿</th>
                </tr>
              </thead>
              <tbody>
                {d.insights.map((i) => (
                  <tr key={i.id} className="border-b border-white/[0.04]">
                    <td className="py-1.5 pr-3">{platformName(i.platform)}</td>
                    <td className="py-1.5 pr-3 text-white/60">{genreName(i.genre)}</td>
                    <td className="py-1.5 pr-3 text-white/60">{i.groupLabel}</td>
                    <td className="py-1.5 pr-3">{i.label}</td>
                    <td className={`py-1.5 pr-3 text-right font-semibold tabular-nums ${liftCls(i.lift)}`}>{i.lift.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{Math.round(i.agree * 100)}%</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {i.avatars} / {i.clients}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{i.posts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
