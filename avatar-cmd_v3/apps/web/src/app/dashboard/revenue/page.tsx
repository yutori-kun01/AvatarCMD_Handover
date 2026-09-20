"use client";
import { useApiData } from "@/hooks/use-api";
import { Panel, Notice, button, date } from "@/components/dashboard/live-ui";
type Revenue = {
  totalRevenue: number;
  records: {
    id: string;
    amount: number;
    platform: string;
    source: string;
    earnedAt: string;
    avatar: { name: string };
  }[];
};
export default function RevenuePage() {
  const result = useApiData<Revenue>("/api/revenue");
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        登録済みの確定売上（日本円）を集計しています。note等からの売上自動取得は未接続です。
      </p>
      <Notice error={result.error} loading={result.loading} />
      <Panel title="確定売上の合計">
        <p className="text-3xl font-semibold">
          {result.data
            ? `¥${result.data.totalRevenue.toLocaleString("ja-JP")}`
            : "—"}
        </p>
        <button className={button} onClick={() => void result.refetch()}>
          更新
        </button>
      </Panel>
      <Panel title="売上明細（直近100件）">
        {!result.loading && !result.data?.records.length && (
          <p className="text-sm text-muted-foreground">
            登録された売上はありません。
          </p>
        )}
        {result.data?.records.map((r) => (
          <div
            key={r.id}
            className="border-b border-white/10 py-3 flex flex-wrap justify-between gap-3"
          >
            <div>
              <p>
                {r.avatar.name} / {r.platform}
              </p>
              <p className="text-xs text-muted-foreground">
                {date(r.earnedAt)} · {r.source}
              </p>
            </div>
            <strong>¥{r.amount.toLocaleString("ja-JP")}</strong>
          </div>
        ))}
      </Panel>
    </div>
  );
}
