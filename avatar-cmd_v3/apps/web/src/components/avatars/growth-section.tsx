"use client";
// アバター > 成長: 各アカウントの成長フェーズ（帯）・到達レベル・改善ループの設定値・自動調整の履歴（成長アルゴリズム）
import { useCallback, useEffect, useState } from "react";
import { api, Badge, Button, Card } from "@/components/settings/ui";
import { PlatformIcon } from "@/components/platform-icon";

type Metric = "views" | "followers" | "engagementRate" | "followRate" | "spreadRate";
type Stage = "seed" | "sprout" | "growth" | "established" | "scale";
type Trend = "up" | "flat" | "down" | "hold" | "new";
type Assessment = "real_growth" | "real_decline" | "noise" | "anomaly";
type Pace = "faster" | "keep" | "slower" | "hold";
const ASSESSMENT: Record<Assessment, string> = { real_growth: "本物の伸び", real_decline: "本物の下降", noise: "通常のぶれ", anomaly: "一時的な外れ値" };
const PACE: Record<Pace, string> = { faster: "間隔を速める", keep: "間隔を維持", slower: "間隔を遅らせる", hold: "様子見" };
interface Phase {
  metrics: { posts: number; medianViews: number | null; followers: number | null; engagementRate: number | null; followRate: number | null; spreadRate: number | null };
  bands: Partial<Record<Metric, number>>;
  labels: Partial<Record<Metric, string>>;
  level: number;
  stage: Stage;
  trend: Trend;
  delta: number | null;
  tolerance: number;
  clock: {
    requiredPosts: number;
    collected: number;
    postsPerDay: number;
    etaDays: number | null;
    earliestAt: string | null;
    latestAt: string | null;
    lowConfidence: boolean;
    observingChange: boolean;
  };
  sigma: number;
  paceFactor: number;
  review: { assessment: Assessment; pace: Pace; mode: "shadow" | "gate"; at: string; applied: boolean; reason: string } | null;
  params: {
    intervalDays: [number, number];
    minViews: number;
    minObservedDays: number;
    minGroupPosts: number;
    exploration: number;
    allowAutoApply: boolean;
    weights: { reach: number; engagement: number; spread: number; follow: number };
  };
}
interface Account {
  accountId: string;
  platform: string;
  platformName: string;
  accountName: string;
  isActive: boolean;
  evaluatedAt: string | null;
  phase: Phase | null;
  tuning: { baselineViews: number | null; baselineRate: number | null; baselineSpread: number | null; margin: number; settleDays: number | null; temperature: number; stagnation: number; evaluations: number } | null;
  arms: { topic: string; winRate: number; tries: number }[];
  history: { at: string; level: number; stage: Stage; trend: Trend; exploration: number; temperature: number; changes: string[] }[];
  profile: { settleDays: number };
}
interface View {
  accounts: Account[];
  bands: Record<Metric, number[]>;
  metricLabels: Record<Metric, string>;
  stageLabels: Record<Stage, string>;
}

const METRICS: Metric[] = ["views", "followers", "engagementRate", "followRate", "spreadRate"];
const TREND = {
  up: { label: "伸びている", cls: "bg-emerald-500/15 text-emerald-300" },
  flat: { label: "停滞", cls: "bg-amber-500/15 text-amber-300" },
  down: { label: "下降", cls: "bg-red-500/15 text-red-300" },
  hold: { label: "様子見", cls: "bg-violet-500/15 text-violet-300" },
  new: { label: "初回の評価", cls: "bg-white/10 text-white/60" },
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—");

/** 次に比べるまで（証拠の時計） */
function ClockBlock({ p, platformName }: { p: Phase; platformName: string }) {
  const c = p.clock;
  const ratio = c.requiredPosts ? Math.min(1, c.collected / c.requiredPosts) : 0;
  return (
    <div className="space-y-2 rounded-lg border border-white/[0.06] p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-white/80">次の比較（証拠がたまったら比べる）</h4>
        {c.observingChange && <Badge className="bg-amber-500/15 text-amber-300">変更後の観測中</Badge>}
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-white/60">出そろった新しい投稿</span>
        <span className="tabular-nums text-white/85">
          {c.collected} / {c.requiredPosts} 件
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="次の比較までにたまった件数">
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <p className="text-white/50">
        {c.collected >= c.requiredPosts
          ? `件数はそろっています。${day(c.earliestAt)} 以降の評価で比べます。`
          : c.etaDays !== null
            ? `あと ${c.requiredPosts - c.collected} 件（1 日 ${c.postsPerDay} 件のペースで約 ${Math.ceil(c.etaDays)} 日）。`
            : "直近 28 日に投稿がありません。"}
        件数がそろわなくても {day(c.latestAt)} には比べます（その場合は確度が低い比較として、停滞に数えません）。
      </p>
      <p className="text-[11px] text-white/35">
        必要件数 = (1.64 × ばらつき {p.sigma} ÷ 見逃したくない変化幅 15%)² × 間隔の倍率 {p.paceFactor}。投稿が多いほど早く、少ないほど長く待って比べます。{platformName} は投稿から指標が出そろうまで {p.params.minObservedDays} 日待ちます。
      </p>
      {p.review && (
        <p className="text-white/55">
          <span className="text-white/35">Jev（{day(p.review.at)}・{p.review.mode === "gate" ? "反映" : "記録のみ"}）:</span> {ASSESSMENT[p.review.assessment]}・{PACE[p.review.pace]}
          {p.review.reason && <span className="text-white/40">（{p.review.reason}）</span>}
        </p>
      )}
    </div>
  );
}
const pct = (r: number | null | undefined, d = 1) => (r === null || r === undefined ? "—" : `${Number((r * 100).toFixed(d))}%`);
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("ja-JP"));
const metricValue = (m: Metric, p: Phase) =>
  m === "views" ? num(p.metrics.medianViews) : m === "followers" ? num(p.metrics.followers) : pct(p.metrics[m], m === "engagementRate" ? 1 : 2);

/** 帯のはしご: 全部の帯を並べ、今の帯を強調する */
function BandLadder({ metric, phase, view }: { metric: Metric; phase: Phase; view: View }) {
  const edges = view.bands[metric];
  const cur = phase.bands[metric];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-white/60">{view.metricLabels[metric]}</span>
        <span className="tabular-nums text-white/80">
          {metricValue(metric, phase)}
          {phase.labels[metric] && <span className="ml-1.5 text-white/40">（{phase.labels[metric]}）</span>}
        </span>
      </div>
      <div className="mt-1 flex gap-0.5" role="img" aria-label={`${view.metricLabels[metric]}: ${edges.length} 段階中 ${cur === undefined ? "未判定" : cur + 1} 段階目`}>
        {edges.map((_, i) => (
          <div key={i} className={`h-2 flex-1 rounded-sm ${cur === undefined ? "bg-white/[0.04]" : i < cur ? "bg-cyan-400/40" : i === cur ? "bg-cyan-300" : "bg-white/[0.06]"}`} />
        ))}
      </div>
    </div>
  );
}

function AccountCard({ a, view, busy, onEvaluate }: { a: Account; view: View; busy: boolean; onEvaluate: () => void }) {
  const p = a.phase;
  const t = a.tuning;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformIcon platform={a.platform} />
        <span className="text-sm font-semibold">
          {a.platformName} {a.accountName}
        </span>
        {p && <Badge className="bg-cyan-500/15 text-cyan-200">{view.stageLabels[p.stage]}</Badge>}
        {p && <Badge className={TREND[p.trend].cls}>{TREND[p.trend].label}</Badge>}
        <span className="ml-auto text-[11px] text-white/35">{a.evaluatedAt ? `評価 ${new Date(a.evaluatedAt).toLocaleString("ja-JP")}` : "未評価"}</span>
        <Button variant="ghost" disabled={busy || !a.isActive} onClick={onEvaluate}>
          {busy ? "評価中…" : "今すぐ評価"}
        </Button>
      </div>
      {!p || !t ? (
        <p className="text-xs text-white/45">まだ評価していません。投稿が公開されると、1 日 1 回自動で評価します（「今すぐ評価」でも実行できます）。</p>
      ) : (
        <>
          <div>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-white/60">到達レベル（表示回数とフォロワーの帯から）</span>
              <span className="font-semibold tabular-nums">{p.level.toFixed(1)} / 10</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, p.level * 10)}%` }} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {METRICS.map((m) => (
              <BandLadder key={m} metric={m} phase={p} view={view} />
            ))}
          </div>
          <p className="text-[11px] text-white/35">直近 28 日・指標のある投稿 {p.metrics.posts} 件から。表示回数は投稿あたりの中央値。帯は境界を 8% 以上越えたときだけ移ります（境界付近で行ったり来たりしないため）。</p>
          {p.clock && <ClockBlock p={p} platformName={a.platformName} />}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 text-xs">
              <h4 className="font-semibold text-white/80">改善ループの設定（自動）</h4>
              <Row k="改善処理の間隔" v={`${p.params.intervalDays[0]}〜${p.params.intervalDays[1]} 日`} />
              <Row k="比較に使う最低表示回数" v={`${p.params.minViews.toLocaleString()} 回`} />
              <Row k="指標を見るまでの日数" v={`${p.params.minObservedDays} 日${t.settleDays !== null ? "（実測）" : `（${a.platformName} の初期値）`}`} />
              <Row k="比較に必要な件数" v={`${p.params.minGroupPosts} 件`} />
              <Row k="新しいトピックを試す割合" v={pct(p.params.exploration, 0)} />
              <Row k="改善案の自動適用" v={p.params.allowAutoApply ? "可" : "不可（初期は承認待ち）"} />
              <Row
                k="重み（到達 / 反応 / 拡散 / フォロー）"
                v={[p.params.weights.reach, p.params.weights.engagement, p.params.weights.spread, p.params.weights.follow].map((w) => Math.round(w * 100)).join(" / ")}
              />
            </div>
            <div className="space-y-1 text-xs">
              <h4 className="font-semibold text-white/80">学習した値</h4>
              <Row k="このアカウントの「ふつう」の表示回数" v={num(t.baselineViews)} />
              <Row k="「ふつう」の反応率 / 拡散率" v={`${pct(t.baselineRate)} / ${pct(t.baselineSpread, 2)}`} />
              <Row k="良い投稿の基準（ふつうとの差）" v={t.margin >= 0 ? `+${t.margin.toFixed(2)}` : t.margin.toFixed(2)} />
              <Row k="探索の温度（停滞で上がり、伸びで下がる）" v={`${t.temperature.toFixed(2)}（停滞 ${t.stagnation} 回）`} />
              <Row k="前回の比較での伸び" v={p.delta === null ? "—" : `${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(3)}（±${p.tolerance} 以内は停滞）`} />
              <Row k="投稿スコアのばらつき（実測）" v={p.sigma?.toFixed(2) ?? "—"} />
              <Row k="評価の回数" v={`${t.evaluations} 回`} />
            </div>
          </div>

          {a.arms.length > 0 && (
            <div className="text-xs">
              <h4 className="mb-1 font-semibold text-white/80">トピックの成績（「良い投稿」になる見込み）</h4>
              <div className="space-y-1">
                {a.arms.slice(0, 8).map((x) => (
                  <div key={x.topic} className="flex items-center gap-2">
                    <span className="w-40 truncate text-white/70" title={x.topic}>
                      {x.topic}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.round(x.winRate * 100)}%` }} />
                    </div>
                    <span className="w-24 text-right tabular-nums text-white/50">
                      {pct(x.winRate, 0)}・{x.tries} 回
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-white/35">自動化ルールで「トピックの選び方: 成長アルゴリズム」にすると、この成績と探索の割合でトピックを選びます。成績は評価のたびに少しずつ忘れます（流行の変化に追従）。</p>
            </div>
          )}

          {a.history.some((h) => h.changes.length) && (
            <div className="text-xs">
              <h4 className="mb-1 font-semibold text-white/80">自動調整の履歴</h4>
              <ul className="space-y-1 text-white/55">
                {a.history
                  .filter((h) => h.changes.length)
                  .slice(0, 10)
                  .map((h) => (
                    <li key={h.at}>
                      <span className="text-white/35">{new Date(h.at).toLocaleDateString("ja-JP")}</span> {h.changes.join(" / ")}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/50">{k}</span>
      <span className="text-right tabular-nums text-white/85">{v}</span>
    </div>
  );
}

export function GrowthSection({ avatarId, onNotice }: { avatarId: string; onNotice: (kind: "ok" | "error", msg: string) => void }) {
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<View>(`/api/avatars/${avatarId}/growth`).then(setV), [avatarId]);
  useEffect(() => {
    load().catch((e) => onNotice("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function evaluate(accountId?: string) {
    setBusy(accountId ?? "all");
    try {
      setV(await api<View>(`/api/avatars/${avatarId}/growth`, { method: "POST", json: accountId ? { accountId } : {} }));
      onNotice("ok", "評価しました");
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!v) return <p className="text-sm text-white/40">読み込み中…</p>;
  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-xs text-white/55">
        <h3 className="text-sm font-semibold text-white">成長アルゴリズム</h3>
        <p>
          表示回数・フォロワー・反応率・フォロー率・拡散率を帯（フェーズ）に分けて、アカウントごとの段階を判定します。段階に合わせて改善処理の間隔・比較の条件・新しいトピックを試す割合を自動で決め、評価のたびに伸びを見て調整します（伸びていれば成績の良いやり方を多めに、停滞・下降なら新しいやり方を多めに）。
        </p>
        <p>判定は絶対値ではなく、このアカウントの「ふつう」との比較で行います。媒体ごとに指標の重みと、指標が出そろうまでの日数（実測で学習）が違います。</p>
        <p>
          評価は毎日行いますが、伸びを比べるのは「判断に足る件数の投稿が出そろったとき」だけです（投稿が多いアカウントほど早く回ります）。比べるときは Jev（設定があれば）が本物の変化か一時的な外れ値かを判定します。Jev
          のモードが「記録のみ（shadow）」なら記録だけ、「反映（gate）」なら決まった範囲で反映します（様子見は連続 1 回まで、比べる間隔は 0.5〜2 倍）。トピックの変更などを適用した後は、変更後の投稿だけがそろうまで比べません。
        </p>
      </Card>
      {v.accounts.length === 0 ? (
        <p className="text-sm text-white/40">アカウントがありません。</p>
      ) : (
        v.accounts.map((a) => <AccountCard key={a.accountId} a={a} view={v} busy={busy === a.accountId || busy === "all"} onEvaluate={() => evaluate(a.accountId)} />)
      )}
    </div>
  );
}
