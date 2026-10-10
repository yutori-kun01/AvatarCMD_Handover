// ================================================
// note 記事の自動化 — 公開前チェック・有料ラインの扱い・公開のタイミング
// ================================================
// ・公開前チェック: 執筆後に投稿前チェック（reviewPost）を通し、承認範囲（all / standard / strict）で公開してよいか決める。
//   保留した記事は note に送らず Avatar CMD の下書き（承認待ち）にする。承認すると予定どおり（予定時刻を過ぎていれば今すぐ）入稿する。
// ・有料ライン: テンプレートが有料なのに本文に <!-- paywall --> が入らなかったとき
//     free  … 無料記事として入稿（従来どおり）
//     hold  … 下書き（承認待ち）にして人が直す
//     retry … 1 回だけ書き直す。それでも入らなければ保留
// ・公開のタイミング: 作成と公開を分ける（作成は自動化ルールの時刻、公開は下の設定）
//     now    … 作成後すぐ
//     delay  … 作成の N 時間後
//     weekly … 決めた曜日・時刻（日本時間）の、まだ埋まっていない最も早い枠

import { ConfigError } from "../http";

export type ArticleApproval = "all" | "standard" | "strict";
export type PaywallFallback = "free" | "hold" | "retry";
export const PAYWALL_FALLBACK_LABEL: Record<PaywallFallback, string> = { free: "無料記事として入稿", hold: "下書きで保留（承認待ち）", retry: "1 回書き直し、だめなら保留" };

export type PublishTiming = { type: "now" } | { type: "delay"; hours: number } | { type: "weekly"; weekdays: number[]; time: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const JST = 9 * 3600_000;

export function normalizePublishTiming(raw: unknown): PublishTiming {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.type === "delay") {
    const hours = Math.round(Number(r.hours));
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 14) throw new ConfigError("公開までの時間は 1〜336 時間で指定してください");
    return { type: "delay", hours };
  }
  if (r.type === "weekly") {
    const weekdays = [...new Set((Array.isArray(r.weekdays) ? r.weekdays : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const time = String(r.time ?? "").trim();
    if (!weekdays.length) throw new ConfigError("公開する曜日を 1 つ以上選んでください");
    if (!TIME_RE.test(time)) throw new ConfigError(`公開の時刻の形式が不正です: ${time}（HH:MM）`);
    return { type: "weekly", weekdays, time };
  }
  return { type: "now" };
}

/**
 * 公開の予定時刻。now は undefined（すぐ）。weekly は taken（このルールの予約済みの公開時刻）と同じ枠を避ける。
 * 作成に時間がかかるので、minLeadMinutes より先の枠だけを使う。
 */
export function nextPublishAt(timing: PublishTiming, now: Date, taken: Date[] = [], minLeadMinutes = 60): Date | undefined {
  if (timing.type === "now") return undefined;
  if (timing.type === "delay") return new Date(now.getTime() + timing.hours * 3600_000);
  const [h, m] = timing.time.split(":").map(Number);
  const j = new Date(now.getTime() + JST);
  for (let d = 0; d < 7 * 26; d++) {
    const day = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + d, h, m) - JST);
    const weekday = new Date(day.getTime() + JST).getUTCDay();
    if (!timing.weekdays.includes(weekday)) continue;
    if (day.getTime() < now.getTime() + minLeadMinutes * 60_000) continue;
    if (taken.some((t) => Math.abs(t.getTime() - day.getTime()) < 30 * 60_000)) continue;
    return day;
  }
  return undefined;
}

export const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

export function describeTiming(t: PublishTiming): string {
  if (t.type === "now") return "作成後すぐ";
  if (t.type === "delay") return `作成の ${t.hours} 時間後`;
  return `毎週 ${t.weekdays.map((d) => WEEKDAY_LABEL[d]).join("・")} ${t.time}`;
}

/** 有料ラインが入っているか */
export function hasPaywall(md: string): boolean {
  return /^\s*<!--\s*paywall\s*-->\s*$/m.test(md);
}

/** 書き直しのときに AI へ渡す追加の指示 */
export const PAYWALL_RETRY_PROMPT =
  "重要: この記事は有料記事です。無料で読める導入のあと、本文の適切な位置（読者が続きを読みたくなる直前）に、単独の行で <!-- paywall --> を必ず 1 つだけ入れてください。";
