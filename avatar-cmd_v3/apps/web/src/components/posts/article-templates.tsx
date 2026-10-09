"use client";
// note 記事テンプレートの管理: 構成・タイトルの付け方・有料/価格・有料ラインの位置・タグ・画像の入れ方・入稿のしかた
// 記事エディタの「テンプレートを適用」、全自動の記事作成、自動化ルール（note 記事）で使う
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { api, Badge, Button, Card, inputCls } from "@/components/settings/ui";

export interface ArticleTemplate {
  id: string;
  name: string;
  structure: string;
  titleHint: string;
  paid: boolean;
  price: number | null;
  paywallHint: string;
  tags: string[];
  visuals: boolean;
  maxVisuals: number;
  eyecatch: boolean;
  publish: "draft" | "publish";
  updatedAt: string;
}

interface Form {
  id?: string;
  name: string;
  structure: string;
  titleHint: string;
  paid: boolean;
  price: string;
  paywallHint: string;
  tags: string;
  visuals: boolean;
  maxVisuals: string;
  eyecatch: boolean;
  publish: "draft" | "publish";
}

const EMPTY: Form = {
  name: "",
  structure: "## 導入（読者の悩みに共感する）\n## 結論（先に答えを言う）\n## 具体的な手順（3 つ）\n## よくある失敗\n## まとめ",
  titleHint: "",
  paid: false,
  price: "",
  paywallHint: "",
  tags: "",
  visuals: true,
  maxVisuals: "4",
  eyecatch: true,
  publish: "draft",
};

const toForm = (t: ArticleTemplate): Form => ({
  id: t.id,
  name: t.name,
  structure: t.structure,
  titleHint: t.titleHint,
  paid: t.paid,
  price: t.price ? String(t.price) : "",
  paywallHint: t.paywallHint,
  tags: t.tags.join(", "),
  visuals: t.visuals,
  maxVisuals: String(t.maxVisuals),
  eyecatch: t.eyecatch,
  publish: t.publish,
});

export function templateSummary(t: ArticleTemplate): string {
  return [t.paid ? `有料 ${t.price?.toLocaleString()}円` : "無料", t.visuals ? `画像・図解 最大${t.maxVisuals}` : "画像なし", t.eyecatch ? "見出し画像あり" : "", t.publish === "publish" ? "公開まで" : "下書きまで", t.tags.length ? `タグ${t.tags.length}` : ""]
    .filter(Boolean)
    .join("・");
}

export function ArticleTemplates({ templates, onChanged, onError }: { templates: ArticleTemplate[]; onChanged: (msg: string) => void; onError: (msg: string) => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await api("/api/articles/templates", {
        method: "POST",
        json: { ...form, price: form.paid ? form.price : null, maxVisuals: Number(form.maxVisuals), tags: form.tags.split(/[,、\s]+/).filter(Boolean) },
      });
      setForm(null);
      onChanged("テンプレートを保存しました");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: ArticleTemplate) {
    if (!confirm(`テンプレート「${t.name}」を削除しますか？（このテンプレートを使う自動化ルールは実行できなくなります）`)) return;
    try {
      await api(`/api/articles/templates/${t.id}`, { method: "DELETE" });
      onChanged("テンプレートを削除しました");
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">記事テンプレート（{templates.length}）</h3>
        {!form && (
          <Button variant="ghost" onClick={() => setForm(EMPTY)}>
            + 新しいテンプレート
          </Button>
        )}
      </div>
      <p className="text-[11px] text-white/40">記事の「型」を決めておくと、エディタで適用したり、テーマを入れるだけで執筆 → 画像 → 見出し画像 → 入稿まで全自動で作れます（自動化ルールの「note 記事」でも使えます）。</p>

      {form ? (
        <div className="space-y-3 rounded-lg border border-white/[0.08] p-3">
          <label className="block text-xs text-white/60">
            テンプレート名
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例: ハウツー記事（有料 500 円）" className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs text-white/60">
            構成・書き方（見出しの並び、口調、文字数など）
            <textarea value={form.structure} onChange={(e) => setForm({ ...form, structure: e.target.value })} rows={6} className={`${inputCls} mt-1 font-mono text-[12px]`} />
          </label>
          <label className="block text-xs text-white/60">
            タイトルの付け方（任意）
            <input value={form.titleHint} onChange={(e) => setForm({ ...form, titleHint: e.target.value })} placeholder="例: 数字を入れて 32 文字以内。【】は使わない" className={`${inputCls} mt-1`} />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-1.5 pb-2 text-xs text-white/60">
              <input type="checkbox" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} /> 有料記事
            </label>
            {form.paid && (
              <label className="text-xs text-white/60">
                価格（円）
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="500" className={`${inputCls} mt-1 !w-28`} />
              </label>
            )}
            {form.paid && (
              <label className="min-w-[14rem] flex-1 text-xs text-white/60">
                有料ラインの位置（任意）
                <input value={form.paywallHint} onChange={(e) => setForm({ ...form, paywallHint: e.target.value })} placeholder="例: 結論のあと、具体的な手順から有料" className={`${inputCls} mt-1`} />
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-1.5 pb-2 text-xs text-white/60">
              <input type="checkbox" checked={form.visuals} onChange={(e) => setForm({ ...form, visuals: e.target.checked })} /> 見出しごとの画像・図解
            </label>
            {form.visuals && (
              <label className="text-xs text-white/60">
                最大
                <input value={form.maxVisuals} onChange={(e) => setForm({ ...form, maxVisuals: e.target.value.replace(/\D/g, "") })} className={`${inputCls} mt-1 !w-16`} />
              </label>
            )}
            <label className="flex items-center gap-1.5 pb-2 text-xs text-white/60">
              <input type="checkbox" checked={form.eyecatch} onChange={(e) => setForm({ ...form, eyecatch: e.target.checked })} /> 見出し画像（1280×670）
            </label>
            <label className="text-xs text-white/60">
              入稿のしかた
              <select value={form.publish} onChange={(e) => setForm({ ...form, publish: e.target.value as Form["publish"] })} className={`${inputCls} mt-1 !w-auto`}>
                <option value="draft">下書きに保存</option>
                <option value="publish">公開まで行う</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-white/60">
            タグ（カンマ区切り）
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="ADHD, 習慣化" className={`${inputCls} mt-1`} />
          </label>
          <div className="flex gap-2">
            <Button disabled={busy || !form.name.trim()} onClick={save}>
              {busy ? "保存中…" : "保存"}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              キャンセル
            </Button>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <p className="text-xs text-white/40">まだありません。</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] p-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{t.name}</span>
                  {t.publish === "publish" && <Badge className="bg-amber-500/15 text-amber-300">公開まで</Badge>}
                </div>
                <div className="truncate text-[11px] text-white/40">{templateSummary(t)}</div>
              </div>
              <button title="編集" onClick={() => setForm(toForm(t))} className="text-white/40 hover:text-white">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button title="削除" onClick={() => remove(t)} className="text-white/40 hover:text-red-300">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
