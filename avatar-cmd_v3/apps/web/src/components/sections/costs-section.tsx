"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { EmptyState, Embedded, Shell, Stat } from "@/components/dashboard/shell";
import { api, Badge, Button, Card, Field, inputCls, Notice } from "@/components/settings/ui";

type Amounts = Record<string, number>;
interface Budget {
  amount: number | null;
  currency: string;
  warnRatio: number;
  action: "warn" | "stop";
  spent: number;
  ratio: number | null;
  level: "none" | "ok" | "warn" | "over";
  incomplete: boolean;
}
interface EstimateCall { provider: string; model: string | null; purpose: string; requests: number; inputTokens: number; outputTokens: number; reads: number; basis: string }
interface EstimateItem { kind: string; id?: string; label: string; avatarId?: string; runsPerMonth: number; calls: EstimateCall[]; amounts: Amounts; unpriced: string[]; notes: string[] }
interface Group {
  key: string; provider: string; model: string | null; purpose: string; avatarId: string | null; context: string | null;
  requests: number; errors: number; retries: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reads: number; quotaUnits: number;
  amounts: Amounts; unpricedRows: number; unpricedUnits: string[];
}
interface Price { id: string; provider: string; model: string; unit: string; price: number; per: number; currency: string; effectiveFrom: string; checkedAt: string; note: string | null }
interface Data {
  budget: Budget;
  estimate: { items: EstimateItem[]; totals: Amounts; unpricedItems: number };
  forecast: { days: number; elapsedDays: number; reliable: boolean; forecast: Record<string, number | null>; actual: { rows: number; totals: Amounts; unpricedRows: number; quotaUnits: number; groups: Group[] } };
  prices: Price[];
  avatars: { id: string; name: string }[];
}

const UNIT: Record<string, string> = {
  input_token: "入力トークン",
  output_token: "出力トークン",
  cache_read_token: "キャッシュ読み取り",
  cache_write_token: "キャッシュ書き込み",
  request: "リクエスト",
  read: "読み取り件数",
};
const PURPOSE: Record<string, string> = {
  post: "投稿生成", article: "記事生成", rewrite: "書き直し（文字数）", review: "投稿前チェック", quote: "引用（判定・文章）", tags: "タグ提案",
  jev_post_gate: "Jev 投稿判定", jev_quote_candidate: "Jev 引用判定", jev_performance: "Jev 改善判定", jev_improvement: "Jev 改善分析",
  x_timeline: "引用探索（タイムライン）", x_metrics: "指標取得（X）", threads_metrics: "指標取得（Threads）", post_publish: "投稿 API",
  style: "画像スタイル分析", visual: "画像・図解の設計", image_generate: "画像生成", image_compare: "画像生成（比較テスト）",
  youtube_api: "YouTube API", youtube_summary: "動画要約", improvement: "改善処理",
};
const CONTEXT: Record<string, string> = { automation: "自動化", quote_scan: "引用探索", metrics: "指標取得", publish: "投稿", manual: "手動", api: "外部API", improvement: "改善処理", youtube: "YouTube" };

const money = (a: Amounts) => {
  const e = Object.entries(a).filter(([, v]) => v > 0);
  return e.length ? e.map(([c, v]) => `${v < 1 ? v.toFixed(4) : v.toFixed(2)} ${c}`).join(" + ") : "0";
};
const num = (v: number) => Math.round(v).toLocaleString("ja-JP");

const emptyPrice = { provider: "anthropic", model: "", unit: "input_token", price: "", per: "1000000", currency: "USD", effectiveFrom: new Date().toISOString().slice(0, 10), checkedAt: new Date().toISOString().slice(0, 10), note: "" };

function CostsSectionInner() {
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [budget, setBudget] = useState({ amount: "", currency: "USD", warnPct: "80", action: "warn" });
  const [price, setPrice] = useState(emptyPrice);
  const [by, setBy] = useState<"provider" | "purpose" | "avatar" | "context">("purpose");

  const load = useCallback(async () => {
    const d = await api<Data>("/api/costs");
    setData(d);
    setBudget({ amount: d.budget.amount ? String(d.budget.amount) : "", currency: d.budget.currency, warnPct: String(Math.round(d.budget.warnRatio * 100)), action: d.budget.action });
  }, []);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", msg: e.message }));
  }, [load]);

  const avatarName = (id: string | null | undefined) => (id ? data?.avatars.find((a) => a.id === id)?.name ?? "(削除済み)" : "—");

  const grouped = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { label: string; requests: number; tokens: number; reads: number; quota: number; amounts: Amounts; unpriced: number; errors: number; retries: number }>();
    for (const g of data.forecast.actual.groups) {
      const label =
        by === "provider" ? `${g.provider}${g.model ? ` / ${g.model}` : ""}` : by === "purpose" ? PURPOSE[g.purpose] ?? g.purpose : by === "avatar" ? avatarName(g.avatarId) : CONTEXT[g.context ?? ""] ?? g.context ?? "その他";
      const x = m.get(label) ?? { label, requests: 0, tokens: 0, reads: 0, quota: 0, amounts: {}, unpriced: 0, errors: 0, retries: 0 };
      x.requests += g.requests;
      x.tokens += g.inputTokens + g.outputTokens + g.cacheReadTokens + g.cacheWriteTokens;
      x.reads += g.reads;
      x.quota += g.quotaUnits;
      x.unpriced += g.unpricedRows;
      x.errors += g.errors;
      x.retries += g.retries;
      for (const [c, v] of Object.entries(g.amounts)) x.amounts[c] = (x.amounts[c] ?? 0) + v;
      m.set(label, x);
    }
    return [...m.values()].sort((a, b) => b.requests - a.requests);
  }, [data, by]);

  async function saveBudget() {
    try {
      await api("/api/costs/budget", {
        method: "PUT",
        json: { amount: budget.amount.trim() ? Number(budget.amount) : null, currency: budget.currency.trim().toUpperCase(), warnRatio: Number(budget.warnPct) / 100, action: budget.action },
      });
      setNotice({ kind: "ok", msg: "予算を保存しました" });
      load();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }

  async function addPrice() {
    try {
      await api("/api/costs/prices", { method: "POST", json: { ...price, price: Number(price.price), per: Number(price.per) } });
      setNotice({ kind: "ok", msg: "単価を登録しました" });
      setPrice(emptyPrice);
      load();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }

  if (!data) return <Shell title="API コスト">{notice ? <Notice kind="error">{notice.msg}</Notice> : <EmptyState>読み込み中…</EmptyState>}</Shell>;
  const b = data.budget;
  const f = data.forecast;

  return (
    <Shell title="API コスト" description="使用量の記録と費用の概算（請求確定額ではありません）" wide>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      <p className="mb-4 text-[11px] text-white/40">
        金額は、記録した使用量と下の料金表から計算した<strong>概算</strong>です。各社の請求額・支出の上限を保証するものではありません。単価が未登録の使用量は 0 円ではなく「未算定」として件数を表示します。YouTube のクォータ（ユニット）は金額と別に表示します。
      </p>

      {b.level === "over" && <Notice kind="error">今月の概算が予算を超えています{b.action === "stop" ? "。新規の生成・探索を停止しています（予約済み投稿の送信は続きます）" : ""}。</Notice>}
      {b.level === "warn" && <Notice kind="error">今月の概算が予算の {Math.round((b.ratio ?? 0) * 100)}% に達しています。</Notice>}

      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <Stat label="① 設定からの月額試算" value={money(data.estimate.totals)} sub={`有効なルール・探索を1か月動かした場合${data.estimate.unpricedItems ? `／未算定を含む項目 ${data.estimate.unpricedItems}件` : ""}`} />
        <Stat label="② 今月の実績（概算）" value={money(f.actual.totals)} sub={`${f.actual.rows}件の記録${f.actual.unpricedRows ? `／未算定 ${f.actual.unpricedRows}件` : ""}${f.actual.quotaUnits ? `／YouTube ${num(f.actual.quotaUnits)} ユニット` : ""}`} />
        <Stat
          label="③ 月末予測"
          value={Object.keys(f.forecast).length ? Object.entries(f.forecast).map(([c, v]) => (v === null ? `— ${c}` : `${v.toFixed(2)} ${c}`)).join(" + ") : "0"}
          sub={`経過 ${f.elapsedDays.toFixed(1)} / ${f.days} 日の実績から直線予測${f.reliable ? "" : "（3日未満のため参考値）"}`}
        />
        <Stat
          label="予算"
          value={b.amount ? `${b.spent.toFixed(2)} / ${b.amount} ${b.currency}` : "未設定"}
          sub={b.amount ? `${Math.round((b.ratio ?? 0) * 100)}%・上限時: ${b.action === "stop" ? "生成・探索を停止" : "警告のみ"}${b.incomplete ? "（未算定・他通貨を含まない）" : ""}` : "設定すると警告・停止できます"}
          tone={b.level === "over" ? "text-red-300" : b.level === "warn" ? "text-amber-300" : "text-white"}
        />
      </div>

      <Card className="mb-6">
        <h3 className="mb-3 text-sm font-semibold">① 設定からの月額試算（項目別＝ルールごとの増分）</h3>
        {data.estimate.items.length === 0 ? (
          <EmptyState>有効な自動化ルール・引用探索はありません</EmptyState>
        ) : (
          <div className="space-y-2 text-xs">
            {data.estimate.items.map((i) => (
              <div key={`${i.kind}:${i.id ?? i.label}`} className="rounded-lg border border-white/[0.06] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.label}</span>
                  {i.avatarId && <Badge className="bg-white/5 text-white/50">{avatarName(i.avatarId)}</Badge>}
                  <span className="text-white/40">月 {i.runsPerMonth.toFixed(0)} 回</span>
                  <span className="flex-1" />
                  <span>{money(i.amounts)}</span>
                  {i.unpriced.length > 0 && <Badge className="bg-amber-500/15 text-amber-300">未算定: {i.unpriced.map((u) => UNIT[u] ?? u).join("・")}</Badge>}
                </div>
                <div className="mt-1 text-[11px] text-white/40">
                  {i.calls
                    .filter((c) => c.requests || c.reads)
                    .map((c) => `${PURPOSE[c.purpose] ?? c.purpose}（${c.provider}${c.model ? ` ${c.model}` : ""}）${c.reads ? `${num(c.reads)}件` : `${num(c.requests)}回`}${c.inputTokens ? `・入力${num(c.inputTokens)}/出力${num(c.outputTokens)}トークン${c.basis === "default" ? "（既定値）" : ""}` : ""}`)
                    .join(" ／ ")}
                </div>
                {i.notes.length > 0 && <div className="mt-1 text-[11px] text-amber-300">{i.notes.join(" ／ ")}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold">② 今月の実績（概算）</h3>
          <span className="flex-1" />
          <select value={by} onChange={(e) => setBy(e.target.value as typeof by)} className={`${inputCls} w-44`}>
            <option value="purpose" className="bg-[#111]">用途別</option>
            <option value="provider" className="bg-[#111]">API・モデル別</option>
            <option value="avatar" className="bg-[#111]">アバター別</option>
            <option value="context" className="bg-[#111]">呼び出し元別</option>
          </select>
        </div>
        {grouped.length === 0 ? (
          <EmptyState>今月の記録はまだありません</EmptyState>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-white/40">
              <tr className="text-left">
                <th className="py-1">区分</th>
                <th className="text-right">回数</th>
                <th className="text-right">トークン</th>
                <th className="text-right">読み取り</th>
                <th className="text-right">クォータ</th>
                <th className="text-right">概算</th>
                <th className="text-right">未算定</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={g.label} className="border-t border-white/[0.05]">
                  <td className="py-1.5">
                    {g.label}
                    {g.errors > 0 && <span className="ml-2 text-red-300">失敗 {g.errors}</span>}
                    {g.retries > 0 && <span className="ml-2 text-white/40">再試行 {g.retries}</span>}
                  </td>
                  <td className="text-right">{num(g.requests)}</td>
                  <td className="text-right">{num(g.tokens)}</td>
                  <td className="text-right">{num(g.reads)}</td>
                  <td className="text-right">{g.quota ? num(g.quota) : "—"}</td>
                  <td className="text-right">{money(g.amounts)}</td>
                  <td className="text-right">{g.unpriced ? <span className="text-amber-300">{g.unpriced}件</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">予算</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field def={{ key: "amount", label: "月の予算（空欄で予算管理なし）", placeholder: "50" }} value={budget.amount} onChange={(v) => setBudget({ ...budget, amount: v })} />
            <Field def={{ key: "currency", label: "通貨", placeholder: "USD" }} value={budget.currency} onChange={(v) => setBudget({ ...budget, currency: v })} />
            <Field def={{ key: "warn", label: "警告する割合（%）", placeholder: "80" }} value={budget.warnPct} onChange={(v) => setBudget({ ...budget, warnPct: v })} />
            <Field
              def={{ key: "action", label: "上限に達したとき", type: "select", options: [{ value: "warn", label: "警告のみ（処理は続ける）" }, { value: "stop", label: "新規の生成・探索を止める" }] }}
              value={budget.action}
              onChange={(v) => setBudget({ ...budget, action: v })}
            />
          </div>
          <p className="text-[11px] text-white/40">
            「止める」は自動化ルールの生成・引用候補の探索など新しく費用が発生する処理を止めます。予約済み投稿の送信と指標の取得は止めません。予算は同じ通貨で単価が登録された分だけで判定します（未算定分は含みません）。
          </p>
          <Button onClick={saveBudget}>予算を保存</Button>
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">料金表に単価を追加</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field def={{ key: "provider", label: "API（anthropic / openai / gemini / typesafe / x / threads / youtube）" }} value={price.provider} onChange={(v) => setPrice({ ...price, provider: v })} />
            <Field def={{ key: "model", label: "モデル（空欄＝全モデル）", placeholder: "claude-sonnet-5" }} value={price.model} onChange={(v) => setPrice({ ...price, model: v })} />
            <Field def={{ key: "unit", label: "課金単位", type: "select", options: Object.entries(UNIT).map(([value, label]) => ({ value, label })) }} value={price.unit} onChange={(v) => setPrice({ ...price, unit: v })} />
            <Field def={{ key: "currency", label: "通貨" }} value={price.currency} onChange={(v) => setPrice({ ...price, currency: v })} />
            <Field def={{ key: "price", label: "単価", placeholder: "3.0" }} value={price.price} onChange={(v) => setPrice({ ...price, price: v })} />
            <Field def={{ key: "per", label: "あたりの数量", placeholder: "1000000" }} value={price.per} onChange={(v) => setPrice({ ...price, per: v })} />
            <Field def={{ key: "from", label: "適用日（YYYY-MM-DD）" }} value={price.effectiveFrom} onChange={(v) => setPrice({ ...price, effectiveFrom: v })} />
            <Field def={{ key: "checked", label: "確認日（YYYY-MM-DD）" }} value={price.checkedAt} onChange={(v) => setPrice({ ...price, checkedAt: v })} />
          </div>
          <Field def={{ key: "note", label: "出典・メモ（料金ページの URL など）" }} value={price.note} onChange={(v) => setPrice({ ...price, note: v })} />
          <Button onClick={addPrice} disabled={!price.price.trim()}>
            追加
          </Button>
        </Card>
      </div>

      <Card className="mt-6">
        <h3 className="mb-3 text-sm font-semibold">料金表</h3>
        {data.prices.length === 0 ? (
          <EmptyState>単価が登録されていません。登録するまで費用は「未算定」になります。</EmptyState>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-white/40">
              <tr className="text-left">
                <th className="py-1">API / モデル</th>
                <th>課金単位</th>
                <th className="text-right">単価</th>
                <th>適用日</th>
                <th>確認日</th>
                <th>出典</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.prices.map((p) => (
                <tr key={p.id} className="border-t border-white/[0.05]">
                  <td className="py-1.5">
                    {p.provider} / {p.model === "*" ? "全モデル" : p.model}
                  </td>
                  <td>{UNIT[p.unit] ?? p.unit}</td>
                  <td className="text-right">
                    {p.price} {p.currency} / {num(p.per)}
                  </td>
                  <td>{new Date(p.effectiveFrom).toLocaleDateString("ja-JP")}</td>
                  <td>{new Date(p.checkedAt).toLocaleDateString("ja-JP")}</td>
                  <td className="max-w-[16rem] truncate text-white/40">{p.note}</td>
                  <td className="text-right">
                    <button
                      onClick={() =>
                        confirm("この単価を削除しますか？（過去の概算にも反映されます）") &&
                        api(`/api/costs/prices/${p.id}`, { method: "DELETE" })
                          .then(load)
                          .catch((e) => setNotice({ kind: "error", msg: e.message }))
                      }
                      className="text-white/40 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  );
}

/** 別の画面のタブとして表示する */
export function CostsSection() {
  return (
    <Embedded>
      <CostsSectionInner />
    </Embedded>
  );
}
