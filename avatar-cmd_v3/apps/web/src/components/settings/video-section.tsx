"use client";
// 設定 > 動画: パイプラインの上限値・合格ライン・工程ごとの画像生成・ナレーション（Fish Audio）・計測サーバー ／ 固定アセット（アバターごと）
import { useEffect, useRef, useState } from "react";
import { api, Badge, Button, Card, Field, inputCls, uploadMedia } from "./ui";

type OnChanged = (msg: string, ok: boolean) => void;
type Provider = "openai" | "gemini" | "";

interface VideoSettings {
  limits: { maxRetries: number; maxI2vShots: number; qcThreshold: number; faceThreshold: number; episodeBudget: number; monthlyBudget: number; currency: string };
  images: {
    storyboard: { provider: Provider | null; model: string; quality: string };
    final: { provider: Provider | null; model: string; quality: string; compare: boolean };
    thumbnail: { provider: Provider | null; model: string };
  };
  fish: { apiKey: string; fromEnv: boolean; model: string; defaultModel: string };
  measure: { url: string; fromEnv: boolean; token: string };
}

const PROVIDER_OPTIONS = [
  { value: "", label: "設定 > 画像生成 の既定" },
  { value: "gemini", label: "Gemini（Nano Banana 系）" },
  { value: "openai", label: "OpenAI（GPT Image 系）" },
];
const QUALITY_OPTIONS = [
  { value: "low", label: "低（試し・安い）" },
  { value: "medium", label: "中" },
  { value: "high", label: "高（本番）" },
];

export function VideoSettingsSection({ onChanged }: { onChanged: OnChanged }) {
  const [s, setS] = useState<VideoSettings | null>(null);
  const [keys, setKeys] = useState({ fishApiKey: "", measureToken: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: VideoSettings }>("/api/video/settings")
      .then((d) => setS(d.settings))
      .catch((e) => onChanged((e as Error).message, false));
  }, [onChanged]);

  if (!s) return <p className="text-sm text-white/40">読み込み中…</p>;
  const L = s.limits;
  const setL = (patch: Partial<VideoSettings["limits"]>) => setS({ ...s, limits: { ...L, ...patch } });
  const numField = (key: keyof VideoSettings["limits"], label: string, help: string, step = "1") => (
    <label className="block">
      <span className="mb-1 block text-xs text-white/60">{label}</span>
      <input type="number" step={step} value={String(L[key])} onChange={(e) => setL({ [key]: Number(e.target.value) } as Partial<VideoSettings["limits"]>)} className={inputCls} />
      <span className="mt-1 block text-[11px] text-white/35">{help}</span>
    </label>
  );

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      const d = await api<{ settings: VideoSettings }>("/api/video/settings", {
        method: "PUT",
        json: { limits: s.limits, images: s.images, fishModel: s.fish.model, measureUrl: s.measure.url, ...keys },
      });
      setS(d.settings);
      setKeys({ fishApiKey: "", measureToken: "" });
      onChanged("動画の設定を保存しました", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">上限値と合格ライン</h3>
        <p className="text-xs text-white/50">
          指示書の config.yaml に当たる値です。上限を超えると工程を止めて報告します。合格ラインは最初の 3 本で人の判断と突き合わせてから決めてください（下げると不合格の見逃しが増えます）。
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {numField("maxRetries", "1 カットの自動作り直し（回）", "超えたらカットを止めて報告")}
          {numField("maxI2vShots", "1 本の動画化（i2v）カット数", "超える分は pseudo への切り替えを提案")}
          {numField("qcThreshold", "検品の合格ライン（0.5〜0.99）", "Jev の確信度がこれ未満なら AI が精査", "0.01")}
          {numField("faceThreshold", "顔の一致度のしきい値（0〜1）", "計測値がこれ未満は顔の不一致の疑い", "0.01")}
          {numField("episodeBudget", "1 本あたりの費用上限", "超えたら全工程を一時停止", "0.01")}
          {numField("monthlyBudget", "1 か月の動画の費用上限", "超えたら新しいエピソードを始めない", "0.01")}
          <Field def={{ key: "cur", label: "通貨（料金表と合わせる）", placeholder: "USD", help: "設定 > API コスト の料金表の通貨" }} value={L.currency} onChange={(x) => setL({ currency: x.toUpperCase() })} />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">工程ごとの画像生成</h3>
        <p className="text-xs text-white/50">絵コンテ（承認用）は安く速く、本番画像は高品質で。API キーは「AI 共通 &gt; API キー」と共通です。</p>
        <div className="grid gap-3 rounded-lg border border-white/5 p-3 md:grid-cols-[8rem_1fr_1fr_1fr]">
          <div className="self-center text-sm">絵コンテ</div>
          <Field def={{ key: "sbp", label: "プロバイダ", type: "select", options: PROVIDER_OPTIONS }} value={s.images.storyboard.provider ?? ""} onChange={(x) => setS({ ...s, images: { ...s.images, storyboard: { ...s.images.storyboard, provider: x as Provider } } })} />
          <Field def={{ key: "sbm", label: "モデル（空欄で既定）" }} value={s.images.storyboard.model} onChange={(x) => setS({ ...s, images: { ...s.images, storyboard: { ...s.images.storyboard, model: x } } })} />
          <Field def={{ key: "sbq", label: "画質", type: "select", options: QUALITY_OPTIONS }} value={s.images.storyboard.quality} onChange={(x) => setS({ ...s, images: { ...s.images, storyboard: { ...s.images.storyboard, quality: x } } })} />
        </div>
        <div className="grid gap-3 rounded-lg border border-white/5 p-3 md:grid-cols-[8rem_1fr_1fr_1fr]">
          <div className="self-center text-sm">本番画像</div>
          <Field def={{ key: "fp", label: "プロバイダ", type: "select", options: PROVIDER_OPTIONS }} value={s.images.final.provider ?? ""} onChange={(x) => setS({ ...s, images: { ...s.images, final: { ...s.images.final, provider: x as Provider } } })} />
          <Field def={{ key: "fm", label: "モデル（空欄で既定）" }} value={s.images.final.model} onChange={(x) => setS({ ...s, images: { ...s.images, final: { ...s.images.final, model: x } } })} />
          <Field
            def={{ key: "fc", label: "両方で生成して比べる", type: "select", options: [{ value: "false", label: "しない" }, { value: "true", label: "する（検品スコアの高い方・費用 2 倍）" }] }}
            value={String(s.images.final.compare)}
            onChange={(x) => setS({ ...s, images: { ...s.images, final: { ...s.images.final, compare: x === "true" } } })}
          />
        </div>
        <div className="grid gap-3 rounded-lg border border-white/5 p-3 md:grid-cols-[8rem_1fr_1fr]">
          <div className="self-center text-sm">サムネイル</div>
          <Field def={{ key: "tp", label: "プロバイダ", type: "select", options: PROVIDER_OPTIONS }} value={s.images.thumbnail.provider ?? ""} onChange={(x) => setS({ ...s, images: { ...s.images, thumbnail: { ...s.images.thumbnail, provider: x as Provider } } })} />
          <Field def={{ key: "tm", label: "モデル（空欄で既定）" }} value={s.images.thumbnail.model} onChange={(x) => setS({ ...s, images: { ...s.images, thumbnail: { ...s.images.thumbnail, model: x } } })} />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">ナレーション（Fish Audio）</h3>
        <p className="text-xs text-white/50">未設定のあいだは文字数（1 分 約 300 字）から尺を見積もって進めます。声 ID と読み辞書は「固定アセット」でアバターごとに設定します。</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            def={{ key: "fk", label: "Fish Audio API キー", type: "password", help: s.fish.apiKey ? `保存済み: ${s.fish.apiKey}（変更する場合のみ入力 / 削除は「-」）` : s.fish.fromEnv ? ".env の FISH_AUDIO_API_KEY を使用中" : "fish.audio の API Keys で発行" }}
            value={keys.fishApiKey}
            configured={!!s.fish.apiKey || s.fish.fromEnv}
            onChange={(x) => setKeys({ ...keys, fishApiKey: x })}
          />
          <Field def={{ key: "fm2", label: "モデル（空欄で既定）", placeholder: s.fish.defaultModel, help: "公式ドキュメントのモデル名" }} value={s.fish.model} onChange={(x) => setS({ ...s, fish: { ...s.fish, model: x } })} />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">計測サーバー（VPS）</h3>
        <p className="text-xs text-white/50">
          顔認識・OCR・骨格推定・構図の計測を行うサーバーです（POST {"{URL}"}/measure）。未設定のあいだは計測値なしで判定します（Jev の確信度が下がるため、多くのカットが AI の精査に回ります）。
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field def={{ key: "mu", label: "URL", type: "url", placeholder: "https://measure.example.com", help: s.measure.fromEnv && !s.measure.url ? ".env の VIDEO_MEASURE_URL を使用中" : undefined }} value={s.measure.url} onChange={(x) => setS({ ...s, measure: { ...s.measure, url: x } })} />
          <Field
            def={{ key: "mt", label: "トークン（任意）", type: "password", help: s.measure.token ? `保存済み: ${s.measure.token}（削除は「-」）` : "Authorization: Bearer で送ります" }}
            value={keys.measureToken}
            configured={!!s.measure.token}
            onChange={(x) => setKeys({ ...keys, measureToken: x })}
          />
        </div>
      </Card>

      <Button onClick={save} disabled={busy}>
        {busy ? "保存中…" : "動画の設定を保存"}
      </Button>
    </div>
  );
}

interface Assets {
  characterText: string;
  characterImages: string[];
  styleText: string;
  styleImages: string[];
  voiceId: string;
  readingDict: { from: string; to: string }[];
  klingElementId: string;
  brand: { font: string; color: string; outline: string };
  approvedAt: string | null;
}

/** 固定アセット（チャンネルの「顔」）: 人が保存・確定したときだけ変わる */
export function VideoAssetsSection({ avatars, onChanged }: { avatars: { id: string; name: string }[]; onChanged: OnChanged }) {
  const [avatarId, setAvatarId] = useState(avatars[0]?.id ?? "");
  const [a, setA] = useState<Assets | null>(null);
  const [dictText, setDictText] = useState("");
  const [busy, setBusy] = useState(false);
  const charRef = useRef<HTMLInputElement>(null);
  const styleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!avatarId) return;
    setA(null);
    api<{ assets: Assets }>(`/api/video/assets?avatarId=${avatarId}`)
      .then((d) => {
        setA(d.assets);
        setDictText(d.assets.readingDict.map((x) => `${x.from},${x.to}`).join("\n"));
      })
      .catch((e) => onChanged((e as Error).message, false));
  }, [avatarId, onChanged]);

  if (!avatars.length) return <p className="text-sm text-white/40">アバターがありません。</p>;

  async function add(kind: "characterImages" | "styleImages", files: FileList | null) {
    if (!a || !files?.length) return;
    setBusy(true);
    try {
      const names: string[] = [];
      for (const f of [...files]) names.push((await uploadMedia(f)).name);
      setA({ ...a, [kind]: [...a[kind], ...names].slice(0, 12) });
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  async function save(approve: boolean) {
    if (!a) return;
    setBusy(true);
    try {
      const readingDict = dictText
        .split("\n")
        .map((l) => l.split(/[,\t]/))
        .filter((p) => p.length >= 2 && p[0].trim() && p[1].trim())
        .map((p) => ({ from: p[0].trim(), to: p[1].trim() }));
      const d = await api<{ assets: Assets }>("/api/video/assets", { method: "PUT", json: { ...a, readingDict, avatarId, approve } });
      setA(d.assets);
      onChanged(approve ? "固定アセットを確定しました" : "固定アセットを保存しました", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  const thumbs = (kind: "characterImages" | "styleImages") =>
    a && (
      <div className="flex flex-wrap gap-2">
        {a[kind].map((n, i) => (
          <div key={n} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/media/${n}`} alt="" className="h-20 w-20 rounded-lg border border-white/10 object-cover" />
            {kind === "characterImages" && i === 0 && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px]">正面・顔の基準</span>}
            <button onClick={() => setA({ ...a, [kind]: a[kind].filter((x) => x !== n) })} className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white/70 hover:text-white">
              ×
            </button>
          </div>
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className={`${inputCls} w-auto`}>
            {avatars.map((x) => (
              <option key={x.id} value={x.id} className="bg-[#111]">
                {x.name}
              </option>
            ))}
          </select>
          {a && (a.approvedAt ? <Badge className="bg-emerald-500/15 text-emerald-300">確定済み（{new Date(a.approvedAt).toLocaleDateString("ja-JP")}）</Badge> : <Badge className="bg-amber-500/15 text-amber-300">未確定（台本の承認 B 以降に進めません）</Badge>)}
        </div>
        <p className="text-xs text-white/50">固定アセットはチャンネルの「顔」です。導入時に確定し、以後は変更が必要なときだけ人が直します（パイプラインが勝手に変えることはありません）。</p>
      </Card>
      {!a ? (
        <p className="text-sm text-white/40">読み込み中…</p>
      ) : (
        <>
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">キャラ設定書</h3>
            <Field def={{ key: "ct", label: "文字の設定（髪型・髪色・目の色・服装・小物・体型・年齢感）", type: "textarea", help: "画像生成の毎回のプロンプト冒頭にそのまま入ります" }} value={a.characterText} onChange={(x) => setA({ ...a, characterText: x })} />
            <div className="text-xs text-white/60">画像（正面・横・斜め45度の全身図、表情差分 6 種）。1 枚目を正面図にしてください（顔の一致度の基準）。</div>
            {thumbs("characterImages")}
            <input ref={charRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => add("characterImages", e.target.files).then(() => charRef.current && (charRef.current.value = ""))} />
            <Button variant="ghost" disabled={busy} onClick={() => charRef.current?.click()}>
              画像を追加
            </Button>
          </Card>
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">画風ガイド</h3>
            <Field def={{ key: "st", label: "色味・光の当て方・線の太さ・背景の描き込み量", type: "textarea", help: "標準はイラスト調・アニメ調。実写と見間違える画像は作りません" }} value={a.styleText} onChange={(x) => setA({ ...a, styleText: x })} />
            <div className="text-xs text-white/60">基準画像（5 枚程度）</div>
            {thumbs("styleImages")}
            <input ref={styleRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => add("styleImages", e.target.files).then(() => styleRef.current && (styleRef.current.value = ""))} />
            <Button variant="ghost" disabled={busy} onClick={() => styleRef.current?.click()}>
              画像を追加
            </Button>
          </Card>
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">声・読み辞書・動画化</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field def={{ key: "vid", label: "Fish Audio の声 ID（1 つに固定）", help: "実在の声優・タレントに似せた声は使わない。クローンは本人の同意と契約がある声だけ" }} value={a.voiceId} onChange={(x) => setA({ ...a, voiceId: x })} />
              <Field def={{ key: "kid", label: "Kling のエレメント ID", help: "正面図を主参照、横・斜めを補助参照として登録した ID" }} value={a.klingElementId} onChange={(x) => setA({ ...a, klingElementId: x })} />
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-white/60">読み辞書（1 行に「表記,読み」）</span>
              <textarea value={dictText} onChange={(e) => setDictText(e.target.value)} rows={5} placeholder={"CIA,シーアイエー\n未解決,みかいけつ"} className={inputCls} />
              <span className="mt-1 block text-[11px] text-white/35">読み間違いを見つけたらここに追記して、エピソード画面でナレーションを作り直します</span>
            </label>
          </Card>
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">ブランド（字幕・テロップ）</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Field def={{ key: "bf", label: "フォント" }} value={a.brand.font} onChange={(x) => setA({ ...a, brand: { ...a.brand, font: x } })} />
              <Field def={{ key: "bc", label: "強調色（#RRGGBB）" }} value={a.brand.color} onChange={(x) => setA({ ...a, brand: { ...a.brand, color: x } })} />
              <Field def={{ key: "bo", label: "縁取り（#RRGGBB）" }} value={a.brand.outline} onChange={(x) => setA({ ...a, brand: { ...a.brand, outline: x } })} />
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => save(false)} disabled={busy}>
              下書きとして保存
            </Button>
            <Button onClick={() => save(true)} disabled={busy || !a.characterText.trim() || !a.styleText.trim()}>
              保存して確定する
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
