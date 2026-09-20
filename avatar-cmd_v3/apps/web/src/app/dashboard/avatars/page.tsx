"use client";
import { useState } from "react";
import { useApiData } from "@/hooks/use-api";
import {
  Panel,
  Notice,
  api,
  useAction,
  field,
  button,
  primary,
  states,
  type Avatar,
} from "@/components/dashboard/live-ui";
export default function AvatarsPage() {
  const data = useApiData<Avatar[]>("/api/avatars");
  const action = useAction();
  const [selected, setSelected] = useState<Avatar | null>(null);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        アバターを登録し、役割と人格を設定します。SNSの接続は「設定」、下書きの生成は「SNS運用」から行えます。
      </p>
      <Notice error={data.error} loading={data.loading} />
      {action.feedback}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="アバター一覧">
          <button className={button} onClick={() => setSelected(null)}>
            新しく登録
          </button>
          {!data.loading && !data.data?.length && (
            <p className="text-sm text-muted-foreground">
              まだアバターがいません。右のフォームから登録してください。
            </p>
          )}
          {data.data?.map((a) => (
            <article
              key={a.id}
              className="rounded-lg border border-white/10 p-4 space-y-3"
            >
              <div className="flex justify-between gap-3">
                <div>
                  <h3 className="font-medium">{a.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {a.role} · {states[a.status]}
                  </p>
                </div>
                <button className={button} onClick={() => setSelected(a)}>
                  編集・人格設定
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                投稿 {a._count.contents}件 / 知識 {a._count.knowledgeItems}件 /{" "}
                {a.snsAccounts
                  .map((s) => `${s.platform}: ${s.accountName}`)
                  .join("、") || "SNS未登録"}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={action.busy}
                  className={button}
                  onClick={() =>
                    action.run(async () => {
                      await api(`/api/avatars/${a.id}`, "PATCH", {
                        status: a.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                      });
                      await data.refetch();
                    }, "稼働状態を更新しました")
                  }
                >
                  {a.status === "ACTIVE" ? "一時停止" : "再開"}
                </button>
                <button
                  disabled={action.busy}
                  className={button + " text-red-300"}
                  onClick={() => {
                    if (
                      !confirm(
                        `「${a.name}」と関連データを削除します。続けますか？`,
                      )
                    )
                      return;
                    const name = prompt(
                      "確認のため、アバター名を入力してください",
                    );
                    if (name !== a.name) return;
                    void action.run(async () => {
                      await api(`/api/avatars/${a.id}`, "DELETE", { name });
                      setSelected(null);
                      await data.refetch();
                    }, "削除しました");
                  }}
                >
                  削除
                </button>
              </div>
            </article>
          ))}
        </Panel>
        <div className="space-y-5">
          <Panel
            title={selected ? `${selected.name} の基本設定` : "アバターを登録"}
          >
            <form
              key={selected?.id ?? "new"}
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const body = Object.fromEntries(new FormData(form));
                void action.run(async () => {
                  await api(
                    selected ? `/api/avatars/${selected.id}` : "/api/avatars",
                    selected ? "PATCH" : "POST",
                    body,
                  );
                  if (!selected) form.reset();
                  await data.refetch();
                });
              }}
            >
              {[
                { name: "name", label: "名前", value: selected?.name },
                { name: "role", label: "担当する役割", value: selected?.role },
                {
                  name: "specialization",
                  label: "専門分野",
                  value: selected?.specialization,
                },
                {
                  name: "targetAudience",
                  label: "届けたい読者",
                  value: selected?.targetAudience,
                },
              ].map((f) => (
                <label key={f.name} className="block space-y-1 text-sm">
                  <span>{f.label}</span>
                  <input
                    className={field}
                    name={f.name}
                    defaultValue={f.value ?? ""}
                    required={["name", "role"].includes(f.name)}
                    maxLength={500}
                  />
                </label>
              ))}
              <button className={primary} disabled={action.busy}>
                保存する
              </button>
            </form>
          </Panel>
          {selected && <Persona key={selected.id} avatarId={selected.id} />}
        </div>
      </div>
    </div>
  );
}
function Persona({ avatarId }: { avatarId: string }) {
  const files = useApiData<
    { filename: string; content: string; updatedAt: string }[]
  >(`/api/avatars/${avatarId}/files`);
  const action = useAction();
  const labels: Record<string, string> = {
    "soul.md": "人格・口調",
    "identity.md": "経歴・自己紹介",
    "rules.md": "守るルール・禁止事項",
  };
  return (
    <Panel title="人格とルール">
      <p className="text-sm text-muted-foreground">
        ここに書いた内容は、次回のAI生成に反映されます。
      </p>
      <Notice error={files.error} loading={files.loading} />
      {action.feedback}
      {files.data?.map((f) => (
        <form
          key={f.filename + f.updatedAt}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const content = String(
              new FormData(e.currentTarget).get("content"),
            );
            void action.run(async () => {
              await api(`/api/avatars/${avatarId}/files`, "PUT", {
                filename: f.filename,
                content,
              });
              await files.refetch();
            });
          }}
        >
          <label className="text-sm block">
            {labels[f.filename]}
            <textarea
              name="content"
              className={field + " mt-2 min-h-40"}
              defaultValue={f.content}
              maxLength={50000}
            />
          </label>
          <button className={button} disabled={action.busy}>
            保存
          </button>
        </form>
      ))}
    </Panel>
  );
}
