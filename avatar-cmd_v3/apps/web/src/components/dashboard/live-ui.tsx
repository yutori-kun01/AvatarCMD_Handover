"use client";
import { useState, useRef, type ReactNode } from "react";
export const field =
  "w-full rounded-lg border border-white/15 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-500";
export const button =
  "rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed";
export const primary =
  button + " bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[.025] p-5 space-y-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}
export function Notice({
  error,
  loading,
}: {
  error?: string | null;
  loading?: boolean;
}) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg border border-red-400/30 p-3 text-sm text-red-300"
    >
      {error}
    </p>
  ) : loading ? (
    <p role="status" className="text-sm text-muted-foreground">
      読み込み中…
    </p>
  ) : null;
}
export async function api<T = unknown>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error ?? "処理に失敗しました");
  return result as T;
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  async function run(fn: () => Promise<void>, success = "保存しました") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setError(null);
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    run,
    feedback: (
      <>
        <Notice error={error} />
        {message && (
          <p role="status" className="text-sm text-emerald-300">
            {message}
          </p>
        )}
      </>
    ),
  };
}
export type Avatar = {
  id: string;
  name: string;
  role: string;
  status: string;
  specialization?: string;
  targetAudience?: string;
  description?: string;
  snsAccounts: { id: string; platform: string; accountName: string }[];
  _count: { contents: number; knowledgeItems: number };
};
export const states: Record<string, string> = {
  ACTIVE: "稼働中",
  PAUSED: "一時停止",
  LEARNING: "学習中",
  ERROR: "エラー",
  DRAFT: "下書き",
  REVIEW: "公開先の確認が必要",
  APPROVED: "承認済み",
  SCHEDULED: "予約済み",
  PUBLISHING: "送信中",
  PUBLISHED: "公開済み",
  FAILED: "失敗",
  ARCHIVED: "保管",
};
export const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
    : "未記録";
