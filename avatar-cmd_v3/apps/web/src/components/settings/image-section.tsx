"use client";
// 設定 > 画像生成: プロバイダ（OpenAI / Gemini）・モデル・画質と、同じプロンプトで両方を試す比較テスト
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Badge, Button, Card, Field, inputCls } from "./ui";

type Provider = "openai" | "gemini";
interface Settings {
  provider: Provider | null;
  quality: "low" | "medium" | "high";
  models: Record<Provider, string>;
  keys: Record<Provider, boolean>;
}
interface ProviderInfo {
  name: string;
  defaultModel: string;
  modelHelp: string;
  pricingUrl: string;
}
interface CompareResult {
  provider: Provider;
  model: string;
  ok: boolean;
  ms?: number;
  mediaName?: string;
  usage?: { inputTokens: number; outputTokens: number };
  cost?: Record<string, number>;
  unpriced?: string[];
  error?: string;
}

const PROVIDERS: Provider[] = ["openai", "gemini"];
const money = (amounts: Record<string, number> | undefined) =>
  amounts && Object.keys(amounts).length ? Object.entries(amounts).map(([c, v]) => `${c} ${v < 1 ? v.toFixed(4) : v.toFixed(2)}`).join(" / ") : null;

export function ImageSection({ avatars, onChanged }: { avatars: { id: string; name: string }[]; onChanged: (msg: string, ok: boolean) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [info, setInfo] = useState<Record<Provider, ProviderInfo> | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("朝の光が差し込むデスクで、ノートに今日の3つのタスクを書き出している人。落ち着いた雰囲気");
  const [aspect, setAspect] = useState("16:9");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [avatarId, setAvatarId] = useState("");
  const [useStyle, setUseStyle] = useState(true);
  const [results, setResults] = useState<CompareResult[] | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api<{ settings: Settings; providers: Record<Provider, ProviderInfo> }>("/api/images/settings")
      .then((d) => {
        setS(d.settings);
        setInfo(d.providers);
        setQuality(d.settings.quality);
      })
      .catch((e) => onChanged(e.message, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(next: Partial<{ provider: string | null; quality: string; models: Partial<Record<Provider, string>> }>) {
    setBusy(true);
    try {
      const d = await api<{ settings: Settings }>("/api/images/settings", { method: "PUT", json: next });
      setS(d.settings);
      onChanged("画像生成の設定を保存しました", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    setTesting(true);
    setResults(null);
    try {
      const d = await api<{ results: CompareResult[] }>("/api/images/compare", { method: "POST", json: { prompt, aspect, quality, avatarId: avatarId || undefined, useStyle } });
      setResults(d.results);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setTesting(false);
    }
  }

  if (!s || !info) return <p className="text-sm text-white/40">読み込み中…</p>;
  const noKey = !s.keys.openai && !s.keys.gemini;

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">画像生成（記事のイメージ画像・見出し画像）</h3>
          <p className="mt-1 text-xs text-white/50">
            API キーは文章生成と共通です（<Link href="/settings?tab=system" className="text-cyan-300 underline">システム &gt; AI</Link>）。Claude は画像を生成しないため、OpenAI か Gemini のキーが必要です。図解（インフォグラフィック）はテンプレートで描くので画像生成の費用はかかりません。
          </p>
        </div>
        {noKey && <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200">OpenAI / Gemini の API キーが未設定です。</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDERS.map((p) => (
            <label key={p} className={`cursor-pointer rounded-xl border p-3 ${s.provider === p ? "border-cyan-400/40 bg-cyan-500/[0.07]" : "border-white/[0.08]"}`}>
              <div className="flex items-center gap-2">
                <input type="radio" checked={s.provider === p} disabled={busy || !s.keys[p]} onChange={() => save({ provider: p })} />
                <span className="text-sm font-semibold">{info[p].name}</span>
                {s.keys[p] ? <Badge className="bg-emerald-500/15 text-emerald-300">キーあり</Badge> : <Badge className="bg-white/10 text-white/50">キーなし</Badge>}
              </div>
              <div className="mt-2">
                <Field
                  def={{ key: `model-${p}`, label: "モデル", placeholder: info[p].defaultModel, help: info[p].modelHelp }}
                  value={s.models[p] === info[p].defaultModel ? "" : s.models[p]}
                  onChange={(v) => setS({ ...s, models: { ...s.models, [p]: v || info[p].defaultModel } })}
                />
              </div>
              <a href={info[p].pricingUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-cyan-300 underline">
                料金ページ
              </a>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-white/60">
            画質（OpenAI）
            <select value={s.quality} onChange={(e) => save({ quality: e.target.value })} className={`${inputCls} mt-1 w-40`}>
              <option value="low" className="bg-[#111]">low（安い）</option>
              <option value="medium" className="bg-[#111]">medium</option>
              <option value="high" className="bg-[#111]">high（高い）</option>
            </select>
          </label>
          <Button disabled={busy} onClick={() => save({ models: s.models })}>
            モデルを保存
          </Button>
        </div>
        <p className="text-[11px] text-white/40">
          費用は 設定 &gt; API コスト の料金表に単価（出力トークン・リクエスト）を登録すると計算されます。使用量は用途「image_generate」で記録され、月の予算を超えると止まります。
        </p>
      </Card>

      <Card className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">比較テスト（OpenAI と Gemini を同じ条件で生成）</h3>
          <p className="mt-1 text-xs text-white/50">キーのあるプロバイダすべてで 1 枚ずつ生成し、画像・かかった時間・トークン数・費用を並べます（1 回ごとに課金されます）。</p>
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={inputCls} />
        <div className="flex flex-wrap items-end gap-3 text-xs text-white/60">
          <label>
            比率
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={`${inputCls} mt-1 w-28`}>
              {["16:9", "4:3", "1:1"].map((a) => (
                <option key={a} value={a} className="bg-[#111]">
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            画質（OpenAI）
            <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} className={`${inputCls} mt-1 w-32`}>
              <option value="low" className="bg-[#111]">low</option>
              <option value="medium" className="bg-[#111]">medium</option>
              <option value="high" className="bg-[#111]">high</option>
            </select>
          </label>
          <label>
            アバターのスタイル
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className={`${inputCls} mt-1 w-44`}>
              <option value="" className="bg-[#111]">使わない</option>
              {avatars.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#111]">
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {avatarId && (
            <label className="flex items-center gap-1.5 pb-2">
              <input type="checkbox" checked={useStyle} onChange={(e) => setUseStyle(e.target.checked)} />
              スタイル定義と参考画像を使う
            </label>
          )}
          <Button disabled={testing || noKey || !prompt.trim()} onClick={compare}>
            {testing ? "生成中…（1 分ほど）" : "比較する"}
          </Button>
        </div>
        {results && (
          <div className="grid gap-4 md:grid-cols-2">
            {results.map((r) => (
              <div key={r.provider} className="space-y-2 rounded-xl border border-white/[0.08] p-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {info[r.provider].name}
                  <span className="text-xs font-normal text-white/40">{r.model}</span>
                </div>
                {r.ok && r.mediaName ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/media/${r.mediaName}`} alt={`${r.provider} の生成結果`} className="w-full rounded-lg" />
                    <dl className="grid grid-cols-2 gap-1 text-xs">
                      <dt className="text-white/40">時間</dt>
                      <dd className="text-right tabular-nums">{((r.ms ?? 0) / 1000).toFixed(1)} 秒</dd>
                      <dt className="text-white/40">トークン（入力 / 出力）</dt>
                      <dd className="text-right tabular-nums">
                        {r.usage?.inputTokens.toLocaleString() ?? "—"} / {r.usage?.outputTokens.toLocaleString() ?? "—"}
                      </dd>
                      <dt className="text-white/40">費用</dt>
                      <dd className="text-right tabular-nums">{money(r.cost) ?? <span className="text-white/40">料金表に単価が未登録</span>}</dd>
                    </dl>
                    <Button variant="ghost" disabled={busy || s.provider === r.provider} onClick={() => save({ provider: r.provider, models: { [r.provider]: r.model } })}>
                      {s.provider === r.provider ? "使用中" : "こちらを使う"}
                    </Button>
                  </>
                ) : (
                  <p className="break-all text-xs text-red-300">{r.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
