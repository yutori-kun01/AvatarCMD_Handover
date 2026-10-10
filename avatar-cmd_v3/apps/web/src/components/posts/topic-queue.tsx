"use client";
// note 記事のテーマ候補: AI が提案したテーマを採用・却下・修正・先頭へ。採用したもの（全自動のルールは提案も）が次の記事のテーマになる
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, Badge, Button, Card, inputCls } from "@/components/settings/ui";

interface Rule {
  id: string;
  name: string;
  actionType: string;
  action: { autoTopics?: "off" | "suggest" | "auto" };
}
interface Suggestion {
  id: string;
  ruleId: string;
  topic: string;
  reason: string | null;
  source: "knowledge" | "sns" | "persona";
  status: "proposed" | "accepted";
}

const SOURCE: Record<Suggestion["source"], string> = { knowledge: "ナレッジ", sns: "反応の良い投稿", persona: "ペルソナ" };

export function TopicQueue({ onNotice }: { onNotice: (kind: "ok" | "error", msg: string) => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleId, setRuleId] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ rules: Rule[] }>("/api/automations")
      .then((d) => {
        const r = d.rules.filter((x) => x.actionType === "note_article");
        setRules(r);
        setRuleId((cur) => cur || r.find((x) => (x.action.autoTopics ?? "off") !== "off")?.id || r[0]?.id || "");
      })
      .catch((e) => onNotice("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const load = useCallback(() => (ruleId ? api<{ suggestions: Suggestion[] }>(`/api/articles/topics?ruleId=${ruleId}`).then((d) => setItems(d.suggestions)) : Promise.resolve(setItems([]))), [ruleId]);
  useEffect(() => {
    load().catch((e) => onNotice("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(key);
    try {
      await fn();
      onNotice("ok", msg);
      await load();
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const patch = (id: string, json: object) => api(`/api/articles/topics/${id}`, { method: "PATCH", json });
  const rule = rules.find((r) => r.id === ruleId);
  const mode = rule?.action.autoTopics ?? "off";

  if (!rules.length) return null;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">テーマ候補</h3>
        <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} className={`${inputCls} !w-auto py-1 text-xs`} aria-label="note 記事ルール">
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <Badge className={mode === "auto" ? "bg-amber-500/15 text-amber-300" : mode === "suggest" ? "bg-cyan-500/15 text-cyan-300" : "bg-white/10 text-white/50"}>
          {mode === "auto" ? "全自動（提案をそのまま使う）" : mode === "suggest" ? "採用したものを使う" : "このルールでは使っていません"}
        </Badge>
        <span className="flex-1" />
        <Button variant="ghost" disabled={!ruleId || busy === "suggest"} onClick={() => act("suggest", () => api(`/api/articles/topics`, { method: "POST", json: { ruleId } }), "テーマ候補を追加しました")}>
          {busy === "suggest" ? "提案中…" : "今すぐ提案"}
        </Button>
      </div>
      <p className="text-[11px] text-white/40">
        ナレッジ（RSS・YouTube の要点）・反応の良かった X / Threads の投稿・ペルソナから、AI が記事のテーマを提案します。過去 90 日の記事と似たテーマは除きます。キューの残りが 3 件を切ると 1 日 1 回まで自動で補充します。
        {mode === "off" && (
          <>
            {" "}
            使うには <Link href="/automation" className="underline">自動化ルール</Link> の「テーマ候補」を設定してください。
          </>
        )}
      </p>
      {!items.length ? (
        <p className="text-xs text-white/40">候補はありません。</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] p-2 text-xs">
              <span className="w-5 text-right tabular-nums text-white/35">{i + 1}</span>
              <Badge className={s.status === "accepted" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/60"}>{s.status === "accepted" ? "採用" : "提案"}</Badge>
              <input value={edit[s.id] ?? s.topic} onChange={(e) => setEdit({ ...edit, [s.id]: e.target.value })} className={`${inputCls} min-w-[12rem] flex-1 py-1 text-xs`} aria-label="テーマ" />
              <span className="text-white/35">{SOURCE[s.source]}</span>
              {edit[s.id] !== undefined && edit[s.id] !== s.topic && (
                <Button variant="ghost" disabled={busy === s.id} onClick={() => act(s.id, () => patch(s.id, { topic: edit[s.id] }), "テーマを修正しました")}>
                  保存
                </Button>
              )}
              {s.status === "proposed" && (
                <Button variant="ghost" disabled={busy === s.id} onClick={() => act(s.id, () => patch(s.id, { status: "accepted" }), "採用しました")}>
                  採用
                </Button>
              )}
              {i > 0 && (
                <Button variant="ghost" disabled={busy === s.id} onClick={() => act(s.id, () => patch(s.id, { toTop: true }), "先頭に移動しました")}>
                  先頭へ
                </Button>
              )}
              <Button variant="ghost" disabled={busy === s.id} onClick={() => act(s.id, () => patch(s.id, { status: "rejected" }), "却下しました")}>
                却下
              </Button>
              {s.reason && <div className="w-full pl-7 text-[11px] text-white/35">{s.reason}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
