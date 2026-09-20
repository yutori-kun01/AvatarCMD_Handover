"use client";
import Link from "next/link";
import { useApiData } from "@/hooks/use-api";
import {
  Panel,
  Notice,
  button,
  states,
  type Avatar,
} from "@/components/dashboard/live-ui";
type Summary = {
  avatars: Avatar[];
  posts: Record<string, number>;
  confirmedRevenueJPY: number;
  activeRules: number;
};
export default function Dashboard() {
  const result = useApiData<Summary>("/api/analytics");
  const data = result.data;
  return (
    <div className="space-y-6">
      <div className="flex justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          登録データと処理結果を表示しています。SNS側の閲覧数・売上の自動収集はまだ接続されていません。
        </p>
        <button className={button} onClick={() => void result.refetch()}>
          更新
        </button>
      </div>
      <Notice error={result.error} loading={result.loading} />
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "アバター", value: data.avatars.length },
              { label: "公開済み投稿", value: data.posts.PUBLISHED ?? 0 },
              {
                label: "確認待ち",
                value: (data.posts.DRAFT ?? 0) + (data.posts.REVIEW ?? 0),
              },
              { label: "有効な定期実行", value: data.activeRules },
            ].map((s) => (
              <Panel key={s.label} title={s.label}>
                <p className="text-3xl font-semibold">{s.value}</p>
              </Panel>
            ))}
          </div>
          <Panel title="運用を始める">
            <div className="flex flex-wrap gap-3">
              <Link className={button} href="/dashboard/avatars">
                1. アバターを登録
              </Link>
              <Link className={button} href="/dashboard/settings">
                2. SNSを接続
              </Link>
              <Link className={button} href="/dashboard/sns">
                3. 下書きを作る
              </Link>
              <Link className={button} href="/dashboard/activity">
                実行履歴
              </Link>
            </div>
          </Panel>
          <Panel title="アバターの稼働状況">
            {!data.avatars.length && (
              <p className="text-sm text-muted-foreground">
                まだアバターが登録されていません。
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {data.avatars.map((a) => (
                <Link
                  key={a.id}
                  href="/dashboard/avatars"
                  className="border border-white/10 rounded-lg p-4 hover:border-cyan-500/50"
                >
                  <div className="flex justify-between">
                    <strong>{a.name}</strong>
                    <span className="text-sm text-cyan-300">
                      {states[a.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {a.role} · 投稿 {a._count.contents}件 · 知識{" "}
                    {a._count.knowledgeItems}件
                  </p>
                </Link>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
