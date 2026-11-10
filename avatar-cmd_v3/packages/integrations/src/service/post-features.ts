// ================================================
// 投稿の構成の分類（コードだけ・AI は使わない） — プラットフォーム × ジャンルの傾向（platform-insights.ts）の集計に使う
// ================================================
// 分類: 書き出し（hook）・長さ（length）・形式（format）・ハッシュタグ（hashtags）・リンク（link）・時間帯（time, 日本時間）

export const LONG_FORM_PLATFORMS = ["wordpress", "zenn", "note", "medium"];

export const FEATURE_GROUPS = {
  hook: { label: "書き出し", values: { question: "問いかけで始める", number: "数字を入れて始める", statement: "言い切りで始める" } },
  length: { label: "長さ", values: { short: "短め", medium: "中くらい", long: "長め", very_long: "とても長い" } },
  format: { label: "形式", values: { list: "箇条書きを使う", paragraphs: "段落を分ける（3 段落以上）", single: "ひとかたまりで書く" } },
  hashtags: { label: "ハッシュタグ", values: { none: "ハッシュタグなし", few: "ハッシュタグ 1〜2 個", many: "ハッシュタグ 3 個以上" } },
  link: { label: "リンク", values: { with: "リンクを付ける", without: "リンクを付けない" } },
  time: { label: "時間帯", values: { morning: "朝（5〜10時）に投稿", daytime: "昼（10〜17時）に投稿", evening: "夕方〜夜（17〜22時）に投稿", night: "深夜（22〜5時）に投稿" } },
} as const;

export type FeatureGroup = keyof typeof FEATURE_GROUPS;
export const FEATURE_GROUP_KEYS = Object.keys(FEATURE_GROUPS) as FeatureGroup[];

/** "hook:question" → 「書き出し」「問いかけで始める」 */
export function describeFeature(feature: string): { group: string; groupLabel: string; label: string } {
  const [g, v] = feature.split(":");
  const def = (FEATURE_GROUPS as Record<string, { label: string; values: Record<string, string> }>)[g];
  return { group: g, groupLabel: def?.label ?? g, label: def?.values[v] ?? feature };
}

/** 長さの区切り（文字数・コードポイント）。短文媒体と長文媒体で分ける */
export const LENGTH_EDGES = { short: [60, 140, 280], long: [3000, 6000] } as const;

const HASHTAG = /(^|[\s　])[#＃][^\s#＃　.,、。!?！？]+/gu;
const URL_RE = /https?:\/\/\S+/;
const LIST_LINE = /^\s*(?:[・•●◆■▶︎→✅✔️☑️\-*]|\d{1,2}[.)．）]|[①-⑳])\s*\S/u;

function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find((l) => l && !/^#{1,6}\s/.test(l) && !/^!\[/.test(l)) ?? "";
}

/** 日本時間の時（0〜23） */
export function jstHour(d: Date): number {
  return (d.getUTCHours() + 9) % 24;
}

/** 1 件の投稿を分類する。戻り値は "group:value" の配列（各分類 1 つずつ。時間帯は publishedAt があるときだけ） */
export function extractFeatures(input: { platform: string; text: string; publishedAt?: Date | null }): string[] {
  const text = input.text ?? "";
  const longForm = LONG_FORM_PLATFORMS.includes(input.platform);
  const out: string[] = [];

  const head = firstLine(text);
  const hook = /[?？]/.test(head) ? "question" : /[0-9０-９]/.test(head) ? "number" : "statement";
  out.push(`hook:${hook}`);

  const len = [...text.replace(URL_RE, "").trim()].length;
  if (longForm) {
    const [a, b] = LENGTH_EDGES.long;
    out.push(`length:${len <= a ? "medium" : len <= b ? "long" : "very_long"}`);
  } else {
    const [a, b, c] = LENGTH_EDGES.short;
    out.push(`length:${len <= a ? "short" : len <= b ? "medium" : len <= c ? "long" : "very_long"}`);
  }

  const lines = text.split("\n");
  const listLines = lines.filter((l) => LIST_LINE.test(l)).length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  out.push(`format:${listLines >= 2 ? "list" : paragraphs >= 3 ? "paragraphs" : "single"}`);

  // 長文記事のタグはハッシュタグとして本文に書かないことが多いので、短文媒体だけ数える
  if (!longForm) {
    const tags = (text.match(HASHTAG) ?? []).length;
    out.push(`hashtags:${tags === 0 ? "none" : tags <= 2 ? "few" : "many"}`);
  }

  out.push(`link:${URL_RE.test(text) ? "with" : "without"}`);

  if (input.publishedAt) {
    const h = jstHour(input.publishedAt);
    out.push(`time:${h >= 5 && h < 10 ? "morning" : h >= 10 && h < 17 ? "daytime" : h >= 17 && h < 22 ? "evening" : "night"}`);
  }
  return out;
}
