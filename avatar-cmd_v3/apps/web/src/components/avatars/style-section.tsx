"use client";
// アバター > 画像スタイル: 参考画像（イメージ画像 / 図解）の登録 → AI でスタイル定義を作成 → 手で調整 → 図解の試し描き
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Badge, Button, Card, inputCls } from "@/components/settings/ui";

type Kind = "image" | "infographic";
interface Ref {
  id: string;
  kind: Kind;
  mediaName: string;
  url: string;
  note: string | null;
  isActive: boolean;
}
interface Style {
  palette: string[];
  background: string;
  text: string;
  muted: string;
  corner: number;
  iconStyle: "solid" | "outline";
  mood?: string;
  illustration?: string;
  composition?: string;
  avoid?: string[];
}

const KINDS: { id: Kind; label: string; help: string }[] = [
  { id: "image", label: "イメージ画像", help: "記事の見出しごとの挿絵・見出し画像の作風。画風・雰囲気・構図・色を読み取り、生成時に参考画像も一緒に渡します" },
  { id: "infographic", label: "図解", help: "インフォグラフィックの配色・角丸・アイコンの塗り/線。図解はテンプレートで描くので、色と形の傾向だけを使います" },
];

export function StyleSection({ avatarId, onNotice }: { avatarId: string; onNotice: (kind: "ok" | "error", msg: string) => void }) {
  const [refs, setRefs] = useState<Ref[]>([]);
  const [styles, setStyles] = useState<Record<Kind, Style> | null>(null);
  const [kind, setKind] = useState<Kind>("image");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [desc, setDesc] = useState("SNS 発信を続けるための 4 つの手順");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await api<{ references: Ref[]; styles: Record<Kind, Style> }>(`/api/avatars/${avatarId}/styles`);
    setRefs(d.references);
    setStyles(d.styles);
  }, [avatarId]);
  useEffect(() => {
    load().catch((e) => onNotice("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function run(label: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(label);
    try {
      await fn();
      if (ok) onNotice("ok", ok);
      await load();
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await run("upload", async () => {
      for (const f of [...files]) {
        const form = new FormData();
        form.append("file", f);
        const r = await fetch("/api/media", { method: "POST", body: form });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "アップロードに失敗しました");
        await api(`/api/avatars/${avatarId}/styles`, { method: "POST", json: { kind, mediaName: d.media.name } });
      }
    }, `${files.length} 枚の参考画像を追加しました`);
    if (fileRef.current) fileRef.current.value = "";
  }

  const st = styles?.[kind];
  const set = (patch: Partial<Style>) => styles && setStyles({ ...styles, [kind]: { ...styles[kind], ...patch } });
  const mine = refs.filter((r) => r.kind === kind);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1 w-fit">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} className={`rounded-lg px-4 py-1.5 text-sm ${kind === k.id ? "bg-white/10 font-semibold" : "text-white/50 hover:text-white"}`}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-white/50">{KINDS.find((k) => k.id === kind)!.help}</p>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">参考画像（{mine.length} / 20）</h3>
          <span className="flex-1" />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button variant="ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === "upload" ? "追加中…" : "画像を追加"}
          </Button>
          <Button disabled={!!busy || !mine.some((r) => r.isActive)} onClick={() => run("analyze", () => api(`/api/avatars/${avatarId}/styles/analyze`, { method: "POST", json: { kind } }), "参考画像からスタイルを作りました")}>
            {busy === "analyze" ? "分析中…" : "AI でスタイルを作る"}
          </Button>
        </div>
        {mine.length === 0 ? (
          <p className="text-xs text-white/40">参考にしたい画像を複数枚追加してください（同じ作風のものを 3〜8 枚がおすすめ）。</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
            {mine.map((r) => (
              <div key={r.id} className={`space-y-1 ${r.isActive ? "" : "opacity-40"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt={r.note ?? "参考画像"} className="aspect-square w-full rounded-lg object-cover" />
                <input
                  defaultValue={r.note ?? ""}
                  placeholder="メモ（任意）"
                  onBlur={(e) => e.target.value !== (r.note ?? "") && run("note", () => api(`/api/style-references/${r.id}`, { method: "PATCH", json: { note: e.target.value } }))}
                  className={`${inputCls} py-1 text-[11px]`}
                />
                <div className="flex justify-between text-[11px]">
                  <button className="text-white/50 hover:text-white" onClick={() => run("toggle", () => api(`/api/style-references/${r.id}`, { method: "PATCH", json: { isActive: !r.isActive } }))}>
                    {r.isActive ? "使わない" : "使う"}
                  </button>
                  <button className="text-red-300/70 hover:text-red-300" onClick={() => confirm("この参考画像を削除しますか？") && run("delete", () => api(`/api/style-references/${r.id}`, { method: "DELETE" }))}>
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {st && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">スタイル定義（AI が作った内容を直せます）</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-white/50">色</span>
            {st.palette.map((c, i) => (
              <input
                key={i}
                type="color"
                value={c}
                onChange={(e) => set({ palette: st.palette.map((x, j) => (j === i ? e.target.value : x)) })}
                className="h-7 w-9 cursor-pointer rounded border border-white/10 bg-transparent"
                title={`色 ${i + 1}`}
              />
            ))}
            <button className="text-xs text-white/40" onClick={() => st.palette.length < 8 && set({ palette: [...st.palette, "#888888"] })}>
              ＋
            </button>
            {st.palette.length > 2 && (
              <button className="text-xs text-white/40" onClick={() => set({ palette: st.palette.slice(0, -1) })}>
                －
              </button>
            )}
            <span className="ml-3 text-xs text-white/50">背景</span>
            <input type="color" value={st.background} onChange={(e) => set({ background: e.target.value })} className="h-7 w-9 rounded border border-white/10 bg-transparent" />
            <span className="text-xs text-white/50">文字</span>
            <input type="color" value={st.text} onChange={(e) => set({ text: e.target.value })} className="h-7 w-9 rounded border border-white/10 bg-transparent" />
          </div>
          <div className="grid gap-3 md:grid-cols-3 text-xs text-white/60">
            <label>
              角丸（{st.corner}px）
              <input type="range" min={0} max={40} value={st.corner} onChange={(e) => set({ corner: Number(e.target.value) })} className="mt-2 w-full" />
            </label>
            <label>
              アイコン
              <select value={st.iconStyle} onChange={(e) => set({ iconStyle: e.target.value as Style["iconStyle"] })} className={`${inputCls} mt-1`}>
                <option value="solid" className="bg-[#111]">塗り</option>
                <option value="outline" className="bg-[#111]">線</option>
              </select>
            </label>
          </div>
          {kind === "image" && (
            <div className="grid gap-3 md:grid-cols-2 text-xs text-white/60">
              {(
                [
                  ["illustration", "画風・タッチ"],
                  ["mood", "雰囲気"],
                  ["composition", "構図"],
                ] as const
              ).map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input value={st[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} className={`${inputCls} mt-1`} />
                </label>
              ))}
              <label>
                避けること（読点区切り）
                <input value={(st.avoid ?? []).join("、")} onChange={(e) => set({ avoid: e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean) })} className={`${inputCls} mt-1`} />
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!!busy} onClick={() => run("save", () => api(`/api/avatars/${avatarId}/styles`, { method: "PATCH", json: { kind, style: st } }), "スタイルを保存しました")}>
              保存
            </Button>
            {kind === "infographic" && (
              <>
                <input value={desc} onChange={(e) => setDesc(e.target.value)} className={`${inputCls} w-72`} placeholder="試しに描く図解の内容" />
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    run("preview", async () => {
                      // 保存してから、AI に設計させて描く
                      await api(`/api/avatars/${avatarId}/styles`, { method: "PATCH", json: { kind, style: st } });
                      const r = await api<{ media: { name: string }; issues?: string[] }>("/api/images/infographic", { method: "POST", json: { avatarId, description: desc } });
                      setPreview(`/media/${r.media.name}`);
                    })
                  }
                >
                  {busy === "preview" ? "作成中…" : "図解を試しに作る"}
                </Button>
              </>
            )}
          </div>
          {preview && kind === "infographic" && (
            <div>
              <Badge className="mb-2 bg-white/5 text-white/50">試し描き</Badge>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="図解の試し描き" className="w-full max-w-2xl rounded-lg" />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
