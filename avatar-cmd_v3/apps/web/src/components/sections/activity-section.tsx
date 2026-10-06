"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Embedded, EmptyState, Shell } from "@/components/dashboard/shell";
import { api, Badge, Card, inputCls, Notice } from "@/components/settings/ui";

interface Log {
  id: string;
  avatarName: string | null;
  action: string;
  category: string;
  level: string;
  description: string;
  createdAt: string;
}

const LEVEL: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-300",
  info: "bg-cyan-500/15 text-cyan-300",
  warning: "bg-amber-500/15 text-amber-300",
  error: "bg-red-500/15 text-red-300",
};
const CATEGORY: Record<string, string> = { sns: "投稿", content: "コンテンツ・自動化", security: "接続・セキュリティ", system: "システム", revenue: "収益" };

function ActivityInner({ avatarId, limit = 200 }: { avatarId?: string; limit?: number }) {
  const params = useSearchParams();
  const [logs, setLogs] = useState<Log[]>([]);
  const [level, setLevel] = useState(params.get("level") ?? "");
  const [category, setCategory] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const q = new URLSearchParams({ ...(level ? { level } : {}), ...(category ? { category } : {}), ...(avatarId ? { avatarId } : {}), limit: String(limit) });
    const load = () => api<{ logs: Log[] }>(`/api/activity?${q}`).then((d) => setLogs(d.logs)).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [level, category, avatarId, limit]);

  return (
    <Shell title="アクティビティ" description="投稿・失敗・接続・自動化の記録">
      {err && <Notice kind="error">{err}</Notice>}
      <div className="mb-4 flex flex-wrap gap-3">
        <select value={level} onChange={(e) => setLevel(e.target.value)} className={`${inputCls} w-40`}>
          <option value="" className="bg-[#111]">すべてのレベル</option>
          <option value="success" className="bg-[#111]">成功</option>
          <option value="warning" className="bg-[#111]">警告</option>
          <option value="error" className="bg-[#111]">エラー</option>
          <option value="info" className="bg-[#111]">情報</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} w-52`}>
          <option value="" className="bg-[#111]">すべてのカテゴリ</option>
          {Object.entries(CATEGORY).map(([k, v]) => (
            <option key={k} value={k} className="bg-[#111]">{v}</option>
          ))}
        </select>
      </div>
      {logs.length === 0 ? (
        <EmptyState>記録はまだありません</EmptyState>
      ) : (
        <Card className="max-h-[520px] divide-y divide-white/[0.05] overflow-auto p-0">
          {logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <Badge className={LEVEL[l.level] ?? "bg-white/10 text-white/60"}>{CATEGORY[l.category] ?? l.category}</Badge>
              <div className="min-w-0 flex-1">
                <div className="break-all text-sm">{l.description}</div>
                {l.avatarName && <div className="text-xs text-white/40">{l.avatarName}</div>}
              </div>
              <span className="text-xs text-white/35">{new Date(l.createdAt).toLocaleString("ja-JP")}</span>
            </div>
          ))}
        </Card>
      )}
    </Shell>
  );
}

/** アクティビティ（ダッシュボード・アバター詳細に埋め込む。avatarId で絞り込み） */
export function ActivitySection(props: { avatarId?: string; limit?: number }) {
  return (
    <Embedded>
      <Suspense>
        <ActivityInner {...props} />
      </Suspense>
    </Embedded>
  );
}
