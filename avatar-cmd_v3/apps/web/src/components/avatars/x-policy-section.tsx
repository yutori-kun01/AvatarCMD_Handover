"use client";
// アバター > X API: モード（ECO / BALANCED / AGGRESSIVE / カスタマイズ）・予算・今月の使用量・単価と為替
import { useCallback, useEffect, useState } from "react";
import { api, Badge, Button, Card, inputCls } from "@/components/settings/ui";

type Mode = "eco" | "balanced" | "aggressive" | "custom";
interface Params {
  postsPerDay: number;
  postTimes: string[];
  metricsCheckpoints: number[];
  scanTimes: string[];
  scanPosts: number;
  shortlist: number;
  quotesPerMonth: number;
  profileEveryDays: number;
  userCacheDays: number;
}
interface Estimate {
  postReads: number;
  userReads: number;
  creates: number;
  usd: number;
  yen: number;
}
interface Pricing {
  postRead: number;
  userRead: number;
  postCreate: number;
  usdJpy: number;
}
interface View {
  setting: { mode: Mode; custom: Params; degradeAtYen: number; capYen: number; times: { post: string[]; scan: string[] } };
  pricing: Pricing;
  usage: Estimate;
  level: "normal" | "reduced" | "stopped";
  params: Params;
  /** モード（と利用者の時刻）の値。予算による縮小の前 */
  base: Params;
  modes: Record<Exclude<Mode, "custom">, { label: string; help: string; params: Params; estimate: Estimate }>;
  customEstimate: Estimate;
}

const LEVEL = {
  normal: { label: "通常", cls: "bg-emerald-500/15 text-emerald-300", help: "選んだモードどおりに動いています" },
  reduced: { label: "縮小中", cls: "bg-amber-500/15 text-amber-300", help: "縮小する額を超えたため、引用探索を 1 日 1 回・10 件、指標を後ろ 2 時点に減らしています" },
  stopped: { label: "引用探索を停止", cls: "bg-red-500/15 text-red-300", help: "上限に達したため、引用探索と引用案の作成を止めています。通常投稿と自分の投稿の分析は続けます" },
};
const MODE_ORDER: Mode[] = ["eco", "balanced", "aggressive", "custom"];

function describe(p: Params) {
  return [
    `通常投稿 ${p.postsPerDay ? `${p.postTimes.join("・")}（1日${p.postsPerDay}回）` : "しない"}`,
    `指標 ${p.metricsCheckpoints.map((h) => `${h}h`).join(" / ") || "取らない"}`,
    `探索 ${p.scanTimes.length ? `${p.scanTimes.join("・")} × ${p.scanPosts}件` : "しない"}`,
    `引用 月${p.quotesPerMonth}件まで`,
  ].join("　");
}

export function XPolicySection({ avatarId, onNotice }: { avatarId: string; onNotice: (kind: "ok" | "error", msg: string) => void }) {
  const [v, setV] = useState<View | null>(null);
  const [custom, setCustom] = useState<Params | null>(null);
  const [budget, setBudget] = useState({ degradeAtYen: "", capYen: "" });
  const [pricing, setPricing] = useState<Record<keyof Pricing, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [times, setTimes] = useState<{ post: string[]; scan: string[] }>({ post: [], scan: [] });

  const apply = (d: View) => {
    setV(d);
    setCustom(d.setting.custom);
    // 画面の時刻は「いま使っている値」（モードの回数に合わせた時刻）から始める
    setTimes({ post: d.setting.mode === "custom" ? d.setting.custom.postTimes : d.base.postTimes, scan: d.setting.mode === "custom" ? d.setting.custom.scanTimes : d.base.scanTimes });
    setBudget({ degradeAtYen: String(d.setting.degradeAtYen), capYen: String(d.setting.capYen) });
    setPricing({ postRead: String(d.pricing.postRead), userRead: String(d.pricing.userRead), postCreate: String(d.pricing.postCreate), usdJpy: String(d.pricing.usdJpy) });
  };
  const load = useCallback(() => api<View>(`/api/avatars/${avatarId}/x-policy`).then(apply), [avatarId]);
  useEffect(() => {
    load().catch((e) => onNotice("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function save(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      apply(await api<View>(`/api/avatars/${avatarId}/x-policy`, { method: "PUT", json: body }));
      onNotice("ok", msg);
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePricing() {
    setBusy(true);
    try {
      await api("/api/x-pricing", { method: "PUT", json: Object.fromEntries(Object.entries(pricing!).map(([k, x]) => [k, Number(x)])) });
      await load();
      onNotice("ok", "単価・為替を保存しました（全アバター共通）");
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!v || !custom || !pricing) return <p className="text-sm text-white/40">読み込み中…</p>;
  const cap = v.setting.capYen;
  const pct = cap ? Math.min(100, Math.round((v.usage.yen / cap) * 100)) : 0;
  const degradePct = cap ? Math.min(100, Math.round((v.setting.degradeAtYen / cap) * 100)) : 0;
  const est = (m: Mode) => (m === "custom" ? v.customEstimate : v.modes[m].estimate);
  const numList = (s: string) => s.split(/[,、\s]+/).map((x) => x.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">今月の X API</h3>
          <Badge className={LEVEL[v.level].cls}>{LEVEL[v.level].label}</Badge>
          <span className="text-xs text-white/40">{LEVEL[v.level].help}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">¥{v.usage.yen.toLocaleString()}</span>
          <span className="text-xs text-white/50">/ 上限 ¥{cap.toLocaleString()}（${v.usage.usd.toFixed(2)}）</span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="X API の予算の使用率">
          <div className={`h-full rounded-full ${v.level === "stopped" ? "bg-red-400" : v.level === "reduced" ? "bg-amber-400" : "bg-cyan-400"}`} style={{ width: `${pct}%` }} />
          <div className="absolute top-0 h-full w-px bg-white/50" style={{ left: `${degradePct}%` }} title={`縮小する額 ¥${v.setting.degradeAtYen}`} />
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs text-white/60">
          <div>Post Reads <span className="ml-1 font-semibold text-white tabular-nums">{v.usage.postReads.toLocaleString()}</span></div>
          <div>Post Creates <span className="ml-1 font-semibold text-white tabular-nums">{v.usage.creates.toLocaleString()}</span></div>
          <div>User Reads <span className="ml-1 font-semibold text-white tabular-nums">{v.usage.userReads.toLocaleString()}</span></div>
        </div>
        <p className="text-[11px] text-white/40">いま使っている値: {describe(v.params)}</p>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">モード</h3>
        <div className="grid gap-2 md:grid-cols-4">
          {MODE_ORDER.map((m) => {
            const active = v.setting.mode === m;
            const e = est(m);
            return (
              <button
                key={m}
                disabled={busy}
                onClick={() => save({ mode: m }, `${m === "custom" ? "カスタマイズ" : v.modes[m as Exclude<Mode, "custom">].label} にしました`)}
                className={`rounded-xl border p-3 text-left transition ${active ? "border-cyan-400/40 bg-cyan-500/[0.07]" : "border-white/[0.08] hover:bg-white/[0.04]"}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">{m === "custom" ? "カスタマイズ" : v.modes[m].label}</span>
                  {m === "balanced" && <Badge className="bg-white/10 text-white/60">既定</Badge>}
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  約 ¥{e.yen.toLocaleString()}
                  <span className="text-[11px] font-normal text-white/40"> /月</span>
                </div>
                <div className="mt-1 text-[11px] text-white/45">{m === "custom" ? "各項目を自由に設定" : v.modes[m].help}</div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-white/40">月額は 1 日 2 投稿・引用は上限まで作った場合の見積もりです（単価・為替は下の設定）。AGGRESSIVE は月 5,000 円の商品では原価率が高くなります。</p>
      </Card>

      <Card className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">時刻（日本時間）</h3>
          <p className="text-xs text-white/50">
            {v.setting.mode === "custom" ? "回数はカスタマイズで変えられます。" : "回数はモードで固定です。時刻だけ変えられます。"}
            自動化ルールが X に作る通常投稿は、この時刻の空いている枠に予約されます（今日・明日の枠が埋まっていれば下書きにします）。
          </p>
        </div>
        {(
          [
            ["post", "通常投稿の時刻", v.setting.mode === "custom" ? custom.postsPerDay : v.base.postsPerDay],
            ["scan", "引用探索の時刻", v.setting.mode === "custom" ? custom.scanTimes.length : v.base.scanTimes.length],
          ] as const
        ).map(([k, label, n]) => (
          <div key={k} className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <span className="w-28">
              {label}
              <span className="ml-1 text-white/35">{n}回</span>
            </span>
            {n === 0 ? (
              <span className="text-white/35">{k === "post" ? "通常投稿をしない設定です" : "引用探索をしない設定です"}</span>
            ) : (
              Array.from({ length: n }, (_, i) => (
                <input
                  key={i}
                  type="time"
                  value={times[k][i] ?? ""}
                  onChange={(e) => setTimes({ ...times, [k]: Array.from({ length: n }, (_, j) => (j === i ? e.target.value : times[k][j] ?? "")) })}
                  className={`${inputCls} !w-32 py-1.5`}
                  aria-label={`${label} ${i + 1}`}
                />
              ))
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              v.setting.mode === "custom"
                ? save({ custom: { ...custom, postTimes: times.post.filter(Boolean), scanTimes: times.scan.filter(Boolean) } }, "時刻を保存しました")
                : save({ times: { post: times.post.filter(Boolean), scan: times.scan.filter(Boolean) } }, "時刻を保存しました")
            }
          >
            時刻を保存
          </Button>
          {v.setting.mode !== "custom" && (
            <Button variant="ghost" disabled={busy} onClick={() => save({ times: { post: [], scan: [] } }, "モードの既定の時刻に戻しました")}>
              既定に戻す
            </Button>
          )}
        </div>
      </Card>

      {v.setting.mode === "custom" && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">カスタマイズ</h3>
          <div className="grid gap-3 text-xs text-white/60 md:grid-cols-2">
            <label>
              指標を取る時点（公開からの時間・カンマ区切り）
              <input defaultValue={custom.metricsCheckpoints.join(", ")} onChange={(e) => setCustom({ ...custom, metricsCheckpoints: numList(e.target.value).map(Number) })} className={`${inputCls} mt-1`} placeholder="1, 6, 24" />
            </label>
            <label>
              1 日の通常投稿の回数（0〜10）
              <input
                type="number"
                value={custom.postsPerDay}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(10, Number(e.target.value)));
                  setCustom({ ...custom, postsPerDay: n });
                  setTimes({ ...times, post: Array.from({ length: n }, (_, i) => times.post[i] ?? "") });
                }}
                className={`${inputCls} mt-1`}
              />
            </label>
            <label>
              1 日の引用探索の回数（0〜12）
              <input
                type="number"
                value={times.scan.length}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(12, Number(e.target.value)));
                  setTimes({ ...times, scan: Array.from({ length: n }, (_, i) => times.scan[i] ?? "") });
                  setCustom({ ...custom, scanTimes: Array.from({ length: n }, (_, i) => custom.scanTimes[i] ?? "") });
                }}
                className={`${inputCls} mt-1`}
              />
            </label>
            {(
              [
                ["scanPosts", "1 回に読む投稿数（5〜100）"],
                ["shortlist", "詳しく判定する上位の件数（1〜10）"],
                ["quotesPerMonth", "月に作る引用案の上限"],
                ["profileEveryDays", "プロフィールを取る間隔（日）"],
                ["userCacheDays", "投稿者情報のキャッシュ（日）"],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                {label}
                <input type="number" value={custom[k]} onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })} className={`${inputCls} mt-1`} />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-white/40">回数を変えたら、上の「時刻」で各回の時刻を入れてから保存してください（通常投稿の時刻が回数と合わない場合は既定の時刻、引用探索は未入力の回を除きます）。</p>
          <Button disabled={busy} onClick={() => save({ mode: "custom", custom: { ...custom, postTimes: times.post.filter(Boolean), scanTimes: times.scan.filter(Boolean) } }, "カスタマイズを保存しました")}>
            保存して見積もり
          </Button>
        </Card>
      )}

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">予算（このアバター）</h3>
        <div className="flex flex-wrap items-end gap-3 text-xs text-white/60">
          <label>
            縮小する額（円）
            <input type="number" value={budget.degradeAtYen} onChange={(e) => setBudget({ ...budget, degradeAtYen: e.target.value })} className={`${inputCls} mt-1 w-36`} />
          </label>
          <label>
            上限（円）
            <input type="number" value={budget.capYen} onChange={(e) => setBudget({ ...budget, capYen: e.target.value })} className={`${inputCls} mt-1 w-36`} />
          </label>
          <Button disabled={busy} onClick={() => save({ degradeAtYen: Number(budget.degradeAtYen), capYen: Number(budget.capYen) }, "予算を保存しました")}>
            保存
          </Button>
        </div>
        <p className="text-[11px] text-white/40">縮小する額を超えると引用探索を 1 日 1 回・10 件、指標を後ろ 2 時点に。上限に達すると引用探索と引用案の作成を止めます（通常投稿・自分の投稿の分析は続けます）。0 にすると無効。</p>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">単価と為替（全アバター共通）</h3>
        <div className="flex flex-wrap items-end gap-3 text-xs text-white/60">
          {(
            [
              ["postRead", "Post Read（$/件）"],
              ["userRead", "User Read（$/件）"],
              ["postCreate", "Post Create（$/回）"],
              ["usdJpy", "為替（円/$）"],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input value={pricing[k]} onChange={(e) => setPricing({ ...pricing, [k]: e.target.value })} className={`${inputCls} mt-1 w-32`} />
            </label>
          ))}
          <Button variant="ghost" disabled={busy} onClick={savePricing}>
            保存
          </Button>
        </div>
      </Card>
    </div>
  );
}
