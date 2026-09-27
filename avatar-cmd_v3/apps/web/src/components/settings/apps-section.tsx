"use client";
// 「SNS連携アプリ」: 各SNSの開発者ポータルで取得した Client ID / Secret 等を登録する
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, Badge, Button, Card, CopyText, DocLinks, Field, SUPPORT_LABEL, type PlatformInfo } from "./ui";
import { PlatformIcon } from "@/components/platform-icon";

function AppForm({ p, onSaved }: { p: PlatformInfo; onSaved: (msg: string, ok: boolean) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(p.appFields.map((f) => [f.key, f.type === "password" ? "" : p.app?.values[f.key] ?? ""]))
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/integrations/apps/${p.id}`, { method: "PUT", json: values });
      setValues((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, p.appFields.find((f) => f.key === k)?.type === "password" ? "" : x])));
      onSaved(`${p.name} のアプリ情報を保存しました`, true);
    } catch (e) {
      onSaved(String((e as Error).message), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {p.appFields.map((f) => (
        <Field key={f.key} def={f} value={values[f.key] ?? ""} configured={p.app?.configured[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
      ))}
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </Button>
        <span className="text-[11px] text-white/35">秘密の値は暗号化して保存され、画面には表示されません。削除する場合は「-」を入力して保存。</span>
      </div>
    </div>
  );
}

export function AppsSection({ platforms, onChanged }: { platforms: PlatformInfo[]; onChanged: (msg: string, ok: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-sm text-white/70">
          各SNSの開発者ポータルでアプリを登録し、発行された ID / シークレットをここに入力します。
          OAuth 方式のSNSは、表示されている<strong className="text-white">リダイレクトURI</strong>を開発者ポータル側にも登録してください。
          アプリ登録が不要なSNS（Bluesky・WordPress・Zenn・note など）は「アカウント」タブから直接接続できます。
        </p>
      </Card>
      {platforms.map((p) => {
        const isOpen = open === p.id;
        const needsApp = p.appFields.length > 0;
        return (
          <Card key={p.id} className="p-0">
            <button className="flex w-full items-center gap-3 px-5 py-4 text-left" onClick={() => setOpen(isOpen ? null : p.id)}>
              {isOpen ? <ChevronDown className="h-4 w-4 text-white/40" /> : <ChevronRight className="h-4 w-4 text-white/40" />}
              <PlatformIcon platform={p.id} className="text-lg" />
              <span className="flex-1 text-sm font-semibold">{p.name}</span>
              <Badge className={SUPPORT_LABEL[p.support].cls}>{SUPPORT_LABEL[p.support].label}</Badge>
              {needsApp ? (
                p.app?.complete ? (
                  <Badge className="bg-emerald-500/15 text-emerald-300">登録済み</Badge>
                ) : (
                  <Badge className="bg-white/10 text-white/50">未登録</Badge>
                )
              ) : (
                <Badge className="bg-white/5 text-white/40">アプリ登録不要</Badge>
              )}
            </button>
            {isOpen && (
              <div className="space-y-4 border-t border-white/[0.06] px-5 py-4">
                {p.notes.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-white/60">
                    {p.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                {p.redirectUri && (
                  <div>
                    <div className="mb-1 text-xs text-white/50">リダイレクトURI（開発者ポータルに登録）</div>
                    <CopyText text={p.redirectUri} />
                  </div>
                )}
                <DocLinks docs={p.docs} />
                {needsApp && <AppForm p={p} onSaved={onChanged} />}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
