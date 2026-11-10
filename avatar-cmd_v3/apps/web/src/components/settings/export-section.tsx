"use client";
// 設定 > システム > エクスポート / 取り込み: クライアント（またはアバター）を選んでダウンロード、別のサーバーでファイルを取り込む
import { useEffect, useRef, useState } from "react";
import { api, Badge, Button, Card, inputCls } from "./ui";

type OnChanged = (msg: string, ok: boolean) => void;

interface Info {
  avatars: { id: string; name: string; clientLabel: string | null }[];
  clients: { label: string; count: number }[];
  schemaVersion: string;
  excluded: { model: string; label: string; reason: string }[];
}

interface ImportResult {
  avatars: { id: string; name: string }[];
  counts: Record<string, number>;
  media: { written: number; skipped: number };
  notes: string[];
}

const COUNT_LABEL: Record<string, string> = {
  SnsAccount: "SNS アカウント",
  Content: "投稿",
  PostMetricSnapshot: "投稿の指標の履歴",
  KnowledgeItem: "ナレッジ",
  KnowledgeRevision: "ナレッジの履歴",
  AutomationRule: "自動化ルール",
  ImprovementCycle: "改善の履歴",
  GrowthState: "成長の状態",
  AccountSnapshot: "アカウントの推移",
  Revenue: "収益",
  RevenueItem: "収益アイテム",
  AvatarAnalytics: "分析",
  StyleReference: "参考画像",
  Campaign: "キャンペーン",
  ImprovementSchedule: "改善の日程",
  Collaboration: "コラボ",
};

export function ExportSection({ onChanged }: { onChanged: OnChanged }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [by, setBy] = useState<"client" | "avatars">("client");
  const [client, setClient] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Info>("/api/settings/export")
      .then((d) => {
        setInfo(d);
        if (!d.clients.length) setBy("avatars");
        setClient(d.clients[0]?.label ?? "");
      })
      .catch((e) => onChanged((e as Error).message, false));
  }, [onChanged]);

  if (!info) return <p className="text-sm text-white/40">読み込み中…</p>;

  const ready = by === "client" ? !!client : picked.length > 0;

  async function download() {
    setBusy("export");
    try {
      const r = await fetch("/api/settings/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(by === "client" ? { clientLabel: client } : { avatarIds: picked }), includeMedia }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "エクスポートに失敗しました");
      const blob = await r.blob();
      const cd = r.headers.get("content-disposition") ?? "";
      const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? "avatar-cmd-export.avatarcmd.json.gz");
      const summary = JSON.parse(decodeURIComponent(r.headers.get("x-export-summary") ?? "%7B%7D")) as { avatars?: string[]; media?: number; missingMedia?: string[] };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      const missing = summary.missingMedia?.length ? `。見つからない画像が ${summary.missingMedia.length} 件ありました` : "";
      onChanged(`エクスポートしました（${summary.avatars?.join("・")}、画像 ${summary.media ?? 0} 件${missing}）`, true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File | null) {
    if (!file) return;
    if (!confirm(`「${file.name}」を取り込みますか？アバターは新しく作られます（同じファイルを 2 回取り込むと 2 体ずつできます）。`)) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy("import");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/settings/import", { method: "POST", body: form });
      const d = (await r.json()) as { result?: ImportResult; error?: string };
      if (!r.ok || !d.result) throw new Error(d.error ?? "取り込みに失敗しました");
      setResult(d.result);
      onChanged(`取り込みました: ${d.result.avatars.map((a) => a.name).join("・")}`, true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">エクスポート</h3>
        <p className="text-xs text-white/50">
          選んだアバターのデータ（人格・投稿・指標・ナレッジ・改善の履歴・成長の状態・自動化ルール・画像スタイル・収益）を 1 つのファイルにします。
          運用代行の終了時に、クライアントのサーバーへ引き渡す用途を想定しています。
        </p>
        <div className="flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1 w-fit">
          {(
            [
              ["client", "クライアントで選ぶ"],
              ["avatars", "アバターを選ぶ"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setBy(k)} className={`rounded-lg px-3 py-1 text-xs transition ${by === k ? "bg-white/10 font-semibold text-white" : "text-white/50 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
        {by === "client" ? (
          info.clients.length ? (
            <select value={client} onChange={(e) => setClient(e.target.value)} className={`${inputCls} !w-auto`}>
              {info.clients.map((c) => (
                <option key={c.label} value={c.label} className="bg-[#111]">
                  {c.label}（{c.count} 体）
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-white/40">クライアントのラベルが付いたアバターがありません（アバター &gt; 編集 で付けられます）。</p>
          )
        ) : (
          <div className="flex flex-wrap gap-2">
            {info.avatars.map((a) => (
              <label key={a.id} className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1 text-xs">
                <input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id)))} />
                {a.name}
                {a.clientLabel && <span className="text-white/40">（{a.clientLabel}）</span>}
              </label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-white/70">
          <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} />
          画像（アイコン・参考画像・投稿の添付）を含める
        </label>
        <Button onClick={download} disabled={!ready || !!busy}>
          {busy === "export" ? "作成中…" : "ダウンロード"}
        </Button>
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 p-3 text-[11px] text-amber-100/80">
          <div className="mb-1 font-semibold">含めないもの</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {info.excluded.map((x) => (
              <li key={x.model}>
                {x.label}: {x.reason}
              </li>
            ))}
            <li>SNS のトークン・認証情報（アカウントは停止中で取り込まれ、移行先で接続し直します）</li>
            <li>AI の API キーなどのシステム設定</li>
          </ul>
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">取り込み</h3>
        <p className="text-xs text-white/50">
          エクスポートしたファイル（.avatarcmd.json.gz）を選ぶと、アバターを新しく作って取り込みます。SNS アカウントは停止中、自動化ルールは停止した状態になります。
          ファイルを作ったシステムより古い版には取り込めません（このシステムの版: <span className="font-mono">{info.schemaVersion || "不明"}</span>）。
        </p>
        <input ref={fileRef} type="file" accept=".gz,application/gzip" className="hidden" onChange={(e) => upload(e.target.files?.[0] ?? null)} />
        <Button variant="ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === "import" ? "取り込み中…" : "ファイルを選んで取り込む"}
        </Button>
        {result && (
          <div className="space-y-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3 text-xs">
            <div className="flex flex-wrap gap-1.5">
              {result.avatars.map((a) => (
                <Badge key={a.id} className="bg-emerald-500/15 text-emerald-200">
                  {a.name}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/60">
              {Object.entries(result.counts).map(([k, n]) => (
                <span key={k}>
                  {COUNT_LABEL[k] ?? k}: {n}
                </span>
              ))}
              <span>
                画像: {result.media.written}（既存 {result.media.skipped}）
              </span>
            </div>
            <ul className="list-disc space-y-0.5 pl-4 text-white/70">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
