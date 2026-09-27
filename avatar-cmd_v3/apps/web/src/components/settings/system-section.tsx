"use client";
// 「システム」: 公開URL・APIバージョン・AI（キーと用途ごとの割り当て） ／「セキュリティ」: パスワード変更
import { useState } from "react";
import { api, Button, Card, CopyText, Field } from "./ui";

export interface SystemInfo {
  appUrl: string;
  appUrlFromEnv: string | null;
  metaGraphVersion: string;
  linkedinVersion: string;
}

export interface AiInfo {
  providers: {
    id: string;
    name: string;
    keyHelp: string;
    modelHelp: string;
    /** 保存済みキー（伏せ字）。未保存なら空 */
    apiKey: string;
    /** DB には無いが環境変数で設定されている */
    fromEnv: boolean;
    env: string;
  }[];
  tasks: {
    id: string;
    label: string;
    help: string;
    /** プロバイダごとの既定（最低限の推奨）モデル */
    defaults: Record<string, string>;
    /** 品質を上げたいときの候補 */
    upgrade: Record<string, string>;
    provider: string;
    model: string;
    effectiveProvider: string | null;
    effectiveModel: string | null;
  }[];
  ready: boolean;
}

export interface JevInfo {
  apiKey: string;
  fromEnv: boolean;
  model: string;
  defaultModel: string;
  mode: "off" | "shadow" | "gate";
  /** 直近30日の判定件数・エラー件数・人の判断が付いた件数・一致件数 */
  stats: { total: number; errors: number; reviewed: number; agreed: number };
}

export function SystemSection({ system, ai, jev, onChanged }: { system: SystemInfo; ai: AiInfo; jev: JevInfo; onChanged: (msg: string, ok: boolean) => void }) {
  const [v, setV] = useState({
    appUrl: system.appUrl,
    metaGraphVersion: system.metaGraphVersion,
    linkedinVersion: system.linkedinVersion,
  });
  const emptyKeys = () => Object.fromEntries(ai.providers.map((p) => [p.id, ""]));
  const [aiKeys, setAiKeys] = useState<Record<string, string>>(emptyKeys);
  const [aiTasks, setAiTasks] = useState<Record<string, { provider: string; model: string }>>(() =>
    Object.fromEntries(ai.tasks.map((t) => [t.id, { provider: t.provider, model: t.model }]))
  );
  const [jevForm, setJevForm] = useState({ apiKey: "", model: jev.model, mode: jev.mode as string });
  const providerName = (id: string | null) => ai.providers.find((p) => p.id === id)?.name ?? id ?? "";
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function save() {
    setBusy(true);
    try {
      await api("/api/settings/system", { method: "PUT", json: { ...v, aiKeys, aiTasks, jev: jevForm } });
      setAiKeys(emptyKeys());
      setJevForm({ ...jevForm, apiKey: "" });
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
        <p className="text-xs text-white/50">使うサービスの API キーを入力し、用途ごとにプロバイダとモデルを選びます。「自動」はキーが設定済みのものを Claude → OpenAI → Gemini の順で使います。モデル欄が空欄なら、用途ごとの「最低限の推奨モデル」を使います（重い用途だけ上位モデル）。</p>
        <div className="grid gap-4 md:grid-cols-3">
          {ai.providers.map((p) => (
            <Field
              key={p.id}
              def={{
                key: p.id,
                label: `${p.name} API キー`,
                type: "password",
                help: p.apiKey
                  ? `保存済み: ${p.apiKey}（変更する場合のみ入力 / 削除は「-」）`
                  : p.fromEnv
                    ? `.env の ${p.env} を使用中（ここで入力すると優先されます）`
                    : p.keyHelp,
              }}
              value={aiKeys[p.id] ?? ""}
              configured={!!p.apiKey || p.fromEnv}
              onChange={(x) => setAiKeys({ ...aiKeys, [p.id]: x })}
            />
          ))}
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold text-white/70">用途ごとの割り当て</div>
          {ai.tasks.map((t) => {
            const cur = aiTasks[t.id] ?? { provider: "auto", model: "" };
            const p = ai.providers.find((x) => x.id === cur.provider);
            return (
              <div key={t.id} className="grid gap-3 rounded-lg border border-white/5 p-3 md:grid-cols-[10rem_1fr_1fr]">
                <div>
                  <div className="text-sm">{t.label}</div>
                  <div className="text-[11px] text-white/35">{t.help}</div>
                </div>
                <Field
                  def={{
                    key: `${t.id}-provider`,
                    label: "プロバイダ",
                    type: "select",
                    options: [{ value: "auto", label: "自動（Claude 優先）" }, ...ai.providers.map((x) => ({ value: x.id, label: x.name }))],
                    help: t.effectiveProvider ? `現在: ${providerName(t.effectiveProvider)} / ${t.effectiveModel}` : "API キーが未設定のため生成できません",
                  }}
                  value={cur.provider}
                  onChange={(x) => setAiTasks({ ...aiTasks, [t.id]: { provider: x, model: "" } })}
                />
                {p ? (
                  <Field
                    def={{
                      key: `${t.id}-model`,
                      label: "モデル（空欄で推奨モデル）",
                      placeholder: t.defaults[p.id],
                      help: `推奨（最低限）: ${t.defaults[p.id]}${t.upgrade[p.id] ? ` ／ 品質重視: ${t.upgrade[p.id]}` : ""}。${p.modelHelp}`,
                    }}
                    value={cur.model}
                    onChange={(x) => setAiTasks({ ...aiTasks, [t.id]: { ...cur, model: x } })}
                  />
                ) : (
                  <p className="self-center text-[11px] text-white/35">
                    自動のときは推奨モデルを使います（{ai.providers.map((x) => `${x.name.replace(/（.*）/, "")}: ${t.defaults[x.id]}`).join(" / ")}）
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">判定（TypeSafe Jev）</h3>
        <p className="text-xs text-white/50">
          投稿の可否・引用候補の方向性・改善か継続か、といった「判断」を確率付きで行います（文章の生成には使いません）。
          キーが未設定、またはモードが「使わない」のときは、これまでどおりの流れ（AI の投稿前チェック・コードのルール）で動きます。
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            def={{
              key: "jevKey",
              label: "TypeSafe API キー",
              type: "password",
              help: jev.apiKey ? `保存済み: ${jev.apiKey}（変更する場合のみ入力 / 削除は「-」）` : jev.fromEnv ? ".env の TYPESAFE_API_KEY を使用中" : "typesafe.ai で発行",
            }}
            value={jevForm.apiKey}
            configured={!!jev.apiKey || jev.fromEnv}
            onChange={(x) => setJevForm({ ...jevForm, apiKey: x })}
          />
          <Field
            def={{ key: "jevModel", label: "モデル（空欄で既定）", placeholder: jev.defaultModel, help: "本番は具体的なバージョンに固定（jev-latest は変化を受け入れる場合のみ）" }}
            value={jevForm.model}
            onChange={(x) => setJevForm({ ...jevForm, model: x })}
          />
          <Field
            def={{
              key: "jevMode",
              label: "モード",
              type: "select",
              options: [
                { value: "shadow", label: "記録のみ（shadow・推奨の初期設定）" },
                { value: "gate", label: "判定を反映（gate）" },
                { value: "off", label: "使わない" },
              ],
              help: "記録のみ: 判定を残すだけで処理は変えない。人の判断との一致率を見てから「反映」に切り替えてください",
            }}
            value={jevForm.mode}
            onChange={(x) => setJevForm({ ...jevForm, mode: x })}
          />
        </div>
        <p className="text-[11px] text-white/40">
          直近30日: 判定 {jev.stats.total} 件（エラー {jev.stats.errors} 件）／ 人の判断と比較できた投稿判定 {jev.stats.reviewed} 件
          {jev.stats.reviewed > 0 && `（一致 ${jev.stats.agreed} 件・${Math.round((jev.stats.agreed / jev.stats.reviewed) * 100)}%）`}
        </p>
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
