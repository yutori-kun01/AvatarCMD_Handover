"use client";
import { useEffect, useState } from "react";
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
  date,
  type Avatar,
} from "@/components/dashboard/live-ui";
type Post = {
  id: string;
  avatarId: string;
  avatar: { name: string };
  platform: string;
  content: string;
  status: string;
  updatedAt: string;
  postUrl: string | null;
  scheduledPost: { scheduledAt: string; lastError: string | null } | null;
};
export default function SnsPage() {
  const posts = useApiData<Post[]>("/api/posts");
  const avatars = useApiData<Avatar[]>("/api/avatars");
  const action = useAction();
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const timer = setInterval(() => void posts.refetch(), 15000);
    return () => clearInterval(timer);
  }, [posts.refetch]);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        AIで下書きを作成し、本文を確認してから公開・予約します。X・Threadsは設定画面でAPIトークンを登録してください。noteは下書き作成に対応しています。
      </p>
      {action.feedback}
      <Notice error={posts.error || avatars.error} />
      <Panel title="AIで下書きを作る">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action.run(async () => {
              await api("/api/queue/trigger", "POST", {
                type: "generate_post",
                payload: {
                  avatarId: f.get("avatarId"),
                  data: { platform: f.get("platform"), topic: f.get("topic") },
                },
              });
            }, "生成を受け付けました。下書きは一覧に自動で反映されます。");
          }}
        >
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
          <label className="md:col-span-2 text-sm">
            投稿テーマ
            <textarea
              name="topic"
              className={field}
              required
              maxLength={2000}
            />
          </label>
          <button
            className={primary}
            disabled={action.busy || !avatars.data?.length}
          >
            下書きを生成
          </button>
        </form>
      </Panel>
      <Panel title="投稿一覧（直近50件）">
        <div className="flex gap-3">
          <select
            aria-label="状態で絞り込む"
            className={field + " max-w-xs"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">すべての状態</option>
            {[
              "DRAFT",
              "REVIEW",
              "APPROVED",
              "SCHEDULED",
              "PUBLISHING",
              "PUBLISHED",
              "FAILED",
            ].map((s) => (
              <option key={s} value={s}>
                {states[s]}
              </option>
            ))}
          </select>
          <button className={button} onClick={() => void posts.refetch()}>
            更新
          </button>
        </div>
        {posts.loading && !posts.data && <Notice loading />}
        {!posts.loading && !posts.data?.length && (
          <p className="text-sm text-muted-foreground">
            投稿はまだありません。
          </p>
        )}
        {posts.data
          ?.filter((p) => !filter || p.status === filter)
          .map((p) => (
            <PostEditor
              key={p.id + p.updatedAt}
              post={p}
              refresh={posts.refetch}
            />
          ))}
      </Panel>
    </div>
  );
}
function PostEditor({
  post,
  refresh,
}: {
  post: Post;
  refresh: () => Promise<void>;
}) {
  const action = useAction();
  const [text, setText] = useState(post.content);
  const [schedule, setSchedule] = useState("");
  const locked = ["PUBLISHING", "PUBLISHED"].includes(post.status);
  const canPublish = ["x", "threads"].includes(post.platform.toLowerCase());
  return (
    <article className="rounded-lg border border-white/10 p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-medium">
          {post.avatar.name} · {post.platform}
        </span>
        <span className="text-sm text-cyan-300">{states[post.status]}</span>
      </div>
      {action.feedback}
      {post.status === "REVIEW" && (
        <p className="text-sm text-amber-300">
          公開結果が不明です。SNS側に同じ投稿がないことを確認してから再承認してください。
        </p>
      )}
      <textarea
        aria-label="投稿本文"
        className={field + " min-h-32"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={locked || action.busy}
        maxLength={140000}
      />
      {post.postUrl && /^https:\/\//.test(post.postUrl) && (
        <a
          href={post.postUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-cyan-300 underline"
        >
          公開した投稿を見る
        </a>
      )}
      {post.scheduledPost && (
        <p className="text-sm text-muted-foreground">
          予約日時 {date(post.scheduledPost.scheduledAt)}{" "}
          {post.scheduledPost.lastError}
        </p>
      )}
      {!locked && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={action.busy || !text.trim()}
              onClick={() =>
                action.run(async () => {
                  await api(`/api/posts/${post.id}`, "PATCH", {
                    content: text,
                    status: "DRAFT",
                  });
                  await refresh();
                }, "下書きを保存しました。予約がある場合は解除しました。")
              }
            >
              下書きを保存
            </button>
            <button
              className={primary}
              disabled={action.busy || !text.trim() || !canPublish}
              onClick={() => {
                if (
                  !confirm(
                    post.status === "REVIEW"
                      ? "SNS側に未公開であることを確認しましたか？再送します。"
                      : "この本文を承認して、今すぐ公開しますか？",
                  )
                )
                  return;
                void action.run(async () => {
                  await api(`/api/posts/${post.id}`, "PATCH", {
                    content: text,
                    status: "APPROVED",
                  });
                  await api("/api/queue/trigger", "POST", {
                    type: "publish_post",
                    payload: {
                      avatarId: post.avatarId,
                      data: { contentId: post.id },
                    },
                  });
                  await refresh();
                }, "投稿を受け付けました。結果は実行履歴でも確認できます。");
              }}
            >
              承認して投稿
            </button>
          </div>
          {canPublish && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                予約日時（端末の現地時間）
                <input
                  type="datetime-local"
                  className={field}
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={action.busy || !schedule || !text.trim()}
                onClick={() => {
                  if (!confirm("この内容で公開を予約しますか？")) return;
                  void action.run(async () => {
                    await api(`/api/posts/${post.id}`, "PATCH", {
                      content: text,
                      scheduledAt: new Date(schedule).toISOString(),
                    });
                    await refresh();
                  }, "公開を予約しました");
                }}
              >
                承認して予約
              </button>
            </div>
          )}
          {!canPublish && (
            <p className="text-xs text-muted-foreground">
              このSNSの公開操作は、実サイトでの確認が完了してから利用できます。
            </p>
          )}
        </>
      )}
    </article>
  );
}
