"use client";
import { useApiData } from "@/hooks/use-api";
import {
  Panel,
  Notice,
  api,
  useAction,
  field,
  button,
  primary,
  date,
  type Avatar,
} from "@/components/dashboard/live-ui";
type Rule = {
  id: string;
  name: string;
  isActive: boolean;
  avatar: { name: string };
  triggerConfig: { cron?: string };
  executionCount: number;
  lastExecutedAt: string | null;
  lastError: string | null;
};
export default function AutomationPage() {
  const rules = useApiData<Rule[]>("/api/automations");
  const avatars = useApiData<Avatar[]>("/api/avatars");
  const action = useAction();
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        指定した時刻にAIが下書きを作成します。公開するには「SNS運用」で本文を確認し、承認してください。時刻は日本時間です。
      </p>
      {action.feedback}
      <Notice error={rules.error || avatars.error} loading={rules.loading} />
      <Panel title="定期実行ルール">
        {!rules.loading && !rules.data?.length && (
          <p className="text-sm text-muted-foreground">
            ルールはまだありません。
          </p>
        )}
        {rules.data?.map((r) => (
          <article
            key={r.id}
            className="rounded-lg border border-white/10 p-4 space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3>{r.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {r.avatar.name} · {r.triggerConfig.cron} ·{" "}
                  {r.isActive ? "有効" : "停止中"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={action.busy}
                  className={button}
                  onClick={() =>
                    action.run(async () => {
                      await api(`/api/automations/${r.id}`, "PATCH", {
                        isActive: !r.isActive,
                      });
                      await rules.refetch();
                    })
                  }
                >
                  {r.isActive ? "停止" : "有効にする"}
                </button>
                <button
                  disabled={action.busy}
                  className={button}
                  onClick={() => {
                    if (confirm(`「${r.name}」を削除しますか？`))
                      void action.run(async () => {
                        await api(`/api/automations/${r.id}`, "DELETE");
                        await rules.refetch();
                      }, "削除しました");
                  }}
                >
                  削除
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              投入回数 {r.executionCount}回 / 最終投入 {date(r.lastExecutedAt)}
            </p>
            {r.lastError && <Notice error={r.lastError} />}
          </article>
        ))}
      </Panel>
      <Panel title="下書き生成を予約">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const [hour, minute] = String(f.get("time")).split(":");
            void action.run(async () => {
              await api("/api/automations", "POST", {
                name: f.get("name"),
                avatarId: f.get("avatarId"),
                triggerType: "schedule",
                triggerConfig: {
                  cron: `${Number(minute)} ${Number(hour)} * * *`,
                },
                actionType: "generate",
                actionConfig: {
                  topic: f.get("topic"),
                  platform: f.get("platform"),
                },
              });
              form.reset();
              await rules.refetch();
            });
          }}
        >
          <label className="text-sm">
            ルール名
            <input name="name" className={field} required maxLength={200} />
          </label>
          <label className="text-sm">
            アバター
            <select name="avatarId" className={field} required>
              <option value="">選択してください</option>
              {avatars.data
                ?.filter((a) => a.status === "ACTIVE")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            SNS
            <select name="platform" className={field}>
              <option value="x">X</option>
              <option value="threads">Threads</option>
              <option value="note">note</option>
            </select>
          </label>
          <label className="text-sm">
            毎日の実行時刻（日本時間）
            <input
              type="time"
              name="time"
              className={field}
              defaultValue="09:00"
              required
            />
          </label>
          <label className="text-sm md:col-span-2">
            テーマ
            <input name="topic" className={field} required maxLength={2000} />
          </label>
          <button
            className={primary}
            disabled={action.busy || !avatars.data?.length}
          >
            ルールを保存
          </button>
        </form>
      </Panel>
    </div>
  );
}
