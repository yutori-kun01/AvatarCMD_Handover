"use client";
// 設定 > 画像生成: プロバイダ（OpenAI / Gemini）・モデル・画質と、同じプロンプトで両方を試す比較テスト
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Badge, Button, Card, inputCls } from "./ui";

type Provider = "openai" | "gemini";
interface Settings {
  provider: Provider | null;
  quality: "low" | "medium" | "high";
  format: "png" | "webp";
  models: Record<Provider, string>;
  keys: Record<Provider, boolean>;
}
interface ProviderInfo {
  name: string;
  defaultModel: string;
  modelHelp: string;
  pricingUrl: string;
  models: { id: string; label: string; note: string }[];
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

const CUSTOM = "__custom__";

/** モデルは一覧から選ぶ（一覧にない新しいモデルは ID を直接入力） */
function ModelPicker({ info, value, disabled, onChange }: { info: ProviderInfo; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  const known = info.models.some((m) => m.id === value);
  const [custom, setCustom] = useState(!known);
  return (
    <div className="mt-2 space-y-1.5 text-xs text-white/60">
      <span>モデル</span>
      <select
        value={custom ? CUSTOM : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return setCustom(true);
          setCustom(false);
          onChange(e.target.value);
        }}
        className={`${inputCls} w-full`}
      >
        {info.models.map((m) => (
          <option key={m.id} value={m.id} className="bg-[#111]">
            {m.label}
            {m.id === info.defaultModel ? "（推奨）" : ""}
          </option>
        ))}
        <option value={CUSTOM} className="bg-[#111]">
          その他（モデル ID を入力）
        </option>
      </select>
      {!custom && (
        <p className="text-[11px] text-white/50">
          <span className="font-mono">{value}</span> — {info.models.find((m) => m.id === value)?.note}
        </p>
      )}
      {custom && <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={info.defaultModel} className={`${inputCls} w-full font-mono`} />}
      <p className="text-[11px] text-white/40">{info.modelHelp}。入力した ID の表記ゆれは保存時に正しい ID に直ります。</p>
    </div>
  );
}

export function ImageSection({ avatars, onChanged }: { avatars: { id: string; name: string }[]; onChanged: (msg: string, ok: boolean) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [info, setInfo] = useState<Record<Provider, ProviderInfo> | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("朝の光が差し込むデスクで、ノートに今日の3つのタスクを書き出している人。落ち着いた雰囲気");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("high");
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

  const [target, setTarget] = useState<"section" | "eyecatch">("section");

  async function save(next: Partial<{ provider: string | null; quality: string; format: string; models: Partial<Record<Provider, string>> }>) {
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
      const d = await api<{ results: CompareResult[] }>("/api/images/compare", { method: "POST", json: { prompt, target, quality, avatarId: avatarId || undefined, useStyle } });
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
            API キーは文章生成と共通です（<Link href="/settings?tab=ai-keys" className="text-cyan-300 underline">AI 共通 &gt; API キー</Link>）。Claude は画像を生成しないため、OpenAI か Gemini のキーが必要です。図解（インフォグラフィック）はテンプレートで描くので画像生成の費用はかかりません。
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
              <ModelPicker info={info[p]} value={s.models[p]} disabled={busy} onChange={(v) => setS({ ...s, models: { ...s.models, [p]: v } })} />
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
              <option value="high" className="bg-[#111]">high（推奨）</option>
              <option value="medium" className="bg-[#111]">medium</option>
              <option value="low" className="bg-[#111]">low（安い）</option>
            </select>
          </label>
          <label className="text-xs text-white/60">
            形式
            <select value={s.format} onChange={(e) => save({ format: e.target.value })} className={`${inputCls} mt-1 w-40`}>
              <option value="png" className="bg-[#111]">PNG（推奨・note で確実）</option>
              <option value="webp" className="bg-[#111]">WebP（容量が小さい）</option>
            </select>
          </label>
          <Button disabled={busy || PROVIDERS.some((p) => !s.models[p].trim())} onClick={() => save({ models: s.models })}>
            モデルを保存
          </Button>
        </div>
        <div className="rounded-lg border border-white/[0.06] p-3 text-xs text-white/60">
          <div className="mb-1 font-semibold text-white/80">出力サイズ（生成後に中央基準で切り抜き）</div>
          <div>見出し画像（note のサムネイル）: 1280 × 670（note 推奨）</div>
          <div>見出しの下の画像・図解: 1280 × 720（16:9。本文の表示幅 620px の 2 倍強で高解像度の画面でもきれい）</div>
          <div className="mt-1 text-white/40">GPT Image 2 以降は用途のサイズ（1280 × 672 / 1280 × 720）で直接生成し、見出し画像は 1280 × 670 に整えます。旧モデル（GPT Image 1 系）と Gemini は横長で生成して中央基準で切り抜きます。</div>
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
            用途
            <select value={target} onChange={(e) => setTarget(e.target.value as typeof target)} className={`${inputCls} mt-1 w-44`}>
              <option value="section" className="bg-[#111]">見出しの下 1280×720</option>
              <option value="eyecatch" className="bg-[#111]">見出し画像 1280×670</option>
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
