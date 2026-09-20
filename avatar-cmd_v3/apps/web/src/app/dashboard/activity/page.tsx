"use client";
import { useApiData } from "@/hooks/use-api";
import { Panel, Notice, button, date } from "@/components/dashboard/live-ui";
type Activity = {
  id: string;
  avatar: { name: string } | null;
  action: string;
  description: string;
  level: string;
  createdAt: string;
};
export default function ActivityPage() {
  const result = useApiData<Activity[]>("/api/activity?limit=100");
  return (
    <Panel title="実行履歴（直近100件）">
      <div className="flex justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          生成・公開・設定変更の実際の処理履歴です。
        </p>
        <button className={button} onClick={() => void result.refetch()}>
          更新
        </button>
      </div>
      <Notice error={result.error} loading={result.loading} />
      {!result.loading && !result.data?.length && (
        <p className="text-sm text-muted-foreground">履歴はまだありません。</p>
      )}
      {result.data?.map((a) => (
        <article key={a.id} className="border-b border-white/10 py-3 space-y-1">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{date(a.createdAt)}</span>
            <span>{a.avatar?.name ?? "システム"}</span>
            <span>{a.level}</span>
          </div>
          <p
            className={
              a.level === "error"
                ? "text-red-300"
                : a.level === "warning"
                  ? "text-amber-300"
                  : ""
            }
          >
            {a.description}
          </p>
        </article>
      ))}
    </Panel>
  );
}
