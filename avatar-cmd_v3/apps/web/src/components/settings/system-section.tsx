"use client";
// 「システム」: 公開URL・APIバージョン・AIキー ／「セキュリティ」: パスワード変更
import { useState } from "react";
import { api, Button, Card, CopyText, Field } from "./ui";

export interface SystemInfo {
  appUrl: string;
  appUrlFromEnv: string | null;
  metaGraphVersion: string;
  linkedinVersion: string;
  geminiApiKey: string;
}

export function SystemSection({ system, onChanged }: { system: SystemInfo; onChanged: (msg: string, ok: boolean) => void }) {
  const [v, setV] = useState({
    appUrl: system.appUrl,
    metaGraphVersion: system.metaGraphVersion,
    linkedinVersion: system.linkedinVersion,
    geminiApiKey: "",
  });
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function save() {
    setBusy(true);
    try {
      await api("/api/settings/system", { method: "PUT", json: v });
      setV({ ...v, geminiApiKey: "" });
      onChanged("システム設定を保存しました", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">公開URL</h3>
        <p className="text-xs text-white/50">
          OAuth のリダイレクトURIと、Instagram / Threads 等が画像・動画を取り込む URL の生成に使います。外部から HTTPS でアクセスできる URL を設定してください。
        </p>
        {origin && origin !== v.appUrl && (
          <p className="text-xs text-amber-300">
            現在アクセスしている URL（{origin}）と設定値が異なります。{" "}
            <button className="underline" onClick={() => setV({ ...v, appUrl: origin })}>
              この URL を使う
            </button>
          </p>
        )}
        <Field def={{ key: "appUrl", label: "公開URL", type: "url", placeholder: "https://avatar-cmd.example.com" }} value={v.appUrl} onChange={(x) => setV({ ...v, appUrl: x })} />
        {system.appUrlFromEnv && <p className="text-[11px] text-white/35">.env の APP_URL: {system.appUrlFromEnv}（ここで保存した値が優先されます）</p>}
        <div>
          <div className="mb-1 text-xs text-white/50">OAuth リダイレクトURIの形式</div>
          <CopyText text={`${v.appUrl.replace(/\/+$/, "")}/api/oauth/<platform>/callback`} />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">API バージョン</h3>
        <p className="text-xs text-white/50">各社のバージョン廃止に合わせてここで更新できます（コード変更不要）。</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            def={{ key: "meta", label: "Meta Graph API（Facebook / Instagram）", placeholder: "v26.0", help: "developers.facebook.com/docs/graph-api/changelog の最新版" }}
            value={v.metaGraphVersion}
            onChange={(x) => setV({ ...v, metaGraphVersion: x })}
          />
          <Field
            def={{ key: "li", label: "LinkedIn-Version（YYYYMM）", placeholder: "202604", help: "毎月リリース・約1年サポート" }}
            value={v.linkedinVersion}
            onChange={(x) => setV({ ...v, linkedinVersion: x })}
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">AI（投稿文の自動生成）</h3>
        <Field
          def={{
            key: "gemini",
            label: "Google Gemini API キー",
            type: "password",
            help: system.geminiApiKey ? `保存済み: ${system.geminiApiKey}（変更する場合のみ入力 / 削除は「-」）` : "Google AI Studio で発行。未設定の場合はモック文章になります",
          }}
          value={v.geminiApiKey}
          configured={!!system.geminiApiKey}
          onChange={(x) => setV({ ...v, geminiApiKey: x })}
        />
      </Card>

      <Button onClick={save} disabled={busy}>
        {busy ? "保存中…" : "システム設定を保存"}
      </Button>
    </div>
  );
}

export function SecuritySection({ encryptionReady, onChanged }: { encryptionReady: boolean; onChanged: (msg: string, ok: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function change() {
    setBusy(true);
    try {
      await api("/api/settings/password", { method: "POST", json: { current, next } });
      setCurrent("");
      setNext("");
      onChanged("パスワードを変更しました", true);
    } catch (e) {
      onChanged((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-sm">
        <h3 className="font-semibold">認証情報の保護</h3>
        <p className="text-xs text-white/60">
          入力された API キー・トークン・Cookie は AES-256-GCM で暗号化して DB に保存されます。暗号鍵（ENCRYPTION_KEY）はサーバーの .env にのみ置かれます。
        </p>
        <p className={`text-xs ${encryptionReady ? "text-emerald-300" : "text-red-300"}`}>
          {encryptionReady ? "✓ ENCRYPTION_KEY 設定済み" : "✗ ENCRYPTION_KEY が未設定です（scripts/setup-env.sh を実行してください）"}
        </p>
        <p className="text-xs text-amber-300/80">ENCRYPTION_KEY を変更・紛失すると保存済みの認証情報は復号できなくなります。バックアップしてください。</p>
      </Card>
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">管理者パスワードの変更</h3>
        <Field def={{ key: "c", label: "現在のパスワード", type: "password" }} value={current} onChange={setCurrent} />
        <Field def={{ key: "n", label: "新しいパスワード（10文字以上）", type: "password" }} value={next} onChange={setNext} />
        <div className="flex gap-2">
          <Button onClick={change} disabled={busy || !current || next.length < 10}>
            変更
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
          >
            ログアウト
          </Button>
        </div>
      </Card>
    </div>
  );
}
