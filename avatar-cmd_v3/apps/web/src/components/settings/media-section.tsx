"use client";
// 設定 > システム > メディアの保存先: ローカル（サーバーのディスク）か Cloudflare R2。R2 の接続テストと、ローカルのファイルの移行
import { useEffect, useState } from "react";
import { api, Badge, Button, Card, Field } from "./ui";

type OnChanged = (msg: string, ok: boolean) => void;

interface StorageInfo {
  mode: "local" | "r2";
  fromEnv: boolean;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretSet: boolean;
  local: { files: number; bytes: number };
}

interface MigrateResponse {
  result: { moved: number; skipped: number; failed: { name: string; error: string }[]; remaining: number; next: string | null };
  storage: StorageInfo;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function MediaStorageSection({ onChanged }: { onChanged: OnChanged }) {
  const [s, setS] = useState<StorageInfo | null>(null);
  const [v, setV] = useState({ accountId: "", bucket: "", accessKeyId: "", secretAccessKey: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteLocal, setDeleteLocal] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    api<{ storage: StorageInfo }>("/api/settings/media")
      .then((d) => {
        setS(d.storage);
        setV((x) => ({ ...x, accountId: d.storage.accountId, bucket: d.storage.bucket }));
      })
      .catch((e) => onChanged((e as Error).message, false));
  }, [onChanged]);

  if (!s) return <p className="text-sm text-white/40">読み込み中…</p>;

  async function save(mode: "local" | "r2") {
    setBusy(mode);
    try {
      const d = await api<{ storage: StorageInfo }>("/api/settings/media", { method: "PUT", json: { ...v, mode } });
      setS(d.storage);
      setV((x) => ({ ...x, accessKeyId: "", secretAccessKey: "" }));
      onChanged(mode === "r2" ? "接続を確認し、保存先を R2 に切り替えました（これから作る画像・動画は R2 に保存されます）" : "保存先をローカルに戻しました", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      await api("/api/settings/media", { method: "POST", json: { action: "test" } });
      onChanged("R2 に接続できました（書き込み・読み込み・削除を確認）", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  /** 100 件ずつ、残りが無くなるまで繰り返す */
  async function migrate() {
    if (deleteLocal && !confirm("R2 にアップロードできたファイルは、サーバーのディスクから削除します。よろしいですか？")) return;
    setBusy("migrate");
    let moved = 0;
    let skipped = 0;
    let failed = 0;
    let after: string | null = null;
    try {
      for (let round = 0; round < 1000; round++) {
        const d: MigrateResponse = await api<MigrateResponse>("/api/settings/media", {
          method: "POST",
          json: { action: "migrate", deleteLocal, after },
        });
        moved += d.result.moved;
        skipped += d.result.skipped;
        failed += d.result.failed.length;
        setS(d.storage);
        setProgress(`アップロード ${moved} 件・R2 にあり ${skipped} 件・失敗 ${failed} 件・残り ${d.result.remaining} 件`);
        if (d.result.failed.length) throw new Error(`${d.result.failed[0].name}: ${d.result.failed[0].error}`);
        if (!d.result.remaining || !d.result.next) break;
        after = d.result.next;
      }
      onChanged(`R2 へ移しました（アップロード ${moved} 件・既にあり ${skipped} 件）`, true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">メディアの保存先</h3>
          <Badge className={s.mode === "r2" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/60"}>{s.mode === "r2" ? "Cloudflare R2" : "ローカル（サーバーのディスク）"}</Badge>
        </div>
        <p className="text-xs text-white/50">
          アップロード・生成した画像や動画（記事の画像・見出し画像・動画パイプラインの素材など）の置き場所です。R2 にすると、サーバーのディスクを使わず、引っ越しやバックアップも楽になります（R2 は外向きの転送料が無料）。
          どちらでも画面や投稿で使う URL（/media/…）は変わりません。予約中の記事の画像も、公開の時刻まで保持されます。
        </p>
        <p className="text-[11px] text-white/40">サーバーのディスクに残っているメディア: {s.local.files} 件（{mb(s.local.bytes)}）</p>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Cloudflare R2 の接続情報</h3>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-white/50">
          <li>Cloudflare ダッシュボード → R2 → 「バケットを作成」（公開アクセスは不要）</li>
          <li>R2 → 「API トークンを管理」→「API トークンを作成」。権限は「オブジェクトの読み取りと書き込み」、対象はそのバケットだけ</li>
          <li>表示されたアクセスキー ID・シークレットアクセスキーと、R2 画面のアカウント ID を下に入力</li>
        </ol>
        {s.fromEnv ? (
          <p className="text-xs text-amber-300">.env の R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY を使っています（変更は .env で行ってください）。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field def={{ key: "acc", label: "アカウント ID", placeholder: "32 桁の英数字" }} value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} />
            <Field def={{ key: "bucket", label: "バケット名", placeholder: "avatar-cmd-media" }} value={v.bucket} onChange={(x) => setV({ ...v, bucket: x })} />
            <Field
              def={{ key: "akid", label: "アクセスキー ID", type: "password", placeholder: s.accessKeyId ? `保存済み（${s.accessKeyId}）・変えるときだけ入力` : "" }}
              value={v.accessKeyId}
              onChange={(x) => setV({ ...v, accessKeyId: x })}
            />
            <Field
              def={{ key: "secret", label: "シークレットアクセスキー", type: "password", placeholder: s.secretSet ? "保存済み・変えるときだけ入力" : "" }}
              value={v.secretAccessKey}
              onChange={(x) => setV({ ...v, secretAccessKey: x })}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!s.fromEnv && (
            <Button disabled={!!busy} onClick={() => save("r2")}>
              {busy === "r2" ? "接続を確認中…" : s.mode === "r2" ? "保存（接続を確認）" : "接続を確認して R2 に切り替える"}
            </Button>
          )}
          <Button variant="ghost" disabled={!!busy} onClick={test}>
            {busy === "test" ? "確認中…" : "接続テスト"}
          </Button>
          {s.mode === "r2" && !s.fromEnv && (
            <Button variant="ghost" disabled={!!busy} onClick={() => confirm("保存先をローカルに戻しますか？（R2 に保存済みのファイルはそのまま読めます）") && save("local")}>
              ローカルに戻す
            </Button>
          )}
        </div>
        <p className="text-[11px] text-white/35">アクセスキー・シークレットは暗号化して保存します。</p>
      </Card>

      {s.mode === "r2" && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">ローカルのメディアを R2 へ移す</h3>
          <p className="text-xs text-white/50">切り替える前に作ったファイルは、サーバーのディスクに残っています（移さなくても今までどおり読めます）。まとめて R2 にアップロードできます。</p>
          <label className="flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" checked={deleteLocal} onChange={(e) => setDeleteLocal(e.target.checked)} /> アップロードできたファイルはサーバーのディスクから消す
          </label>
          <Button disabled={!!busy || !s.local.files} onClick={migrate}>
            {busy === "migrate" ? "移行中…" : `R2 へ移す（${s.local.files} 件）`}
          </Button>
          {progress && <p className="text-[11px] text-white/45">{progress}</p>}
        </Card>
      )}
    </div>
  );
}
