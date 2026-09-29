// ================================================
// 投稿本文の整形（X / Threads 共通）
// ================================================
// - 200文字以内: 改行を取り除いて1件で投稿する
// - 200文字超:   アカウント設定 longPostMode に従う
//     newline = 改行を残して1件で投稿（上限を超える分は自動でツリーに分割）
//     thread  = 200文字以内ずつに分けてツリー（返信の連なり）で投稿
// 上限（X の 280 など）はプラットフォームの数え方（measure）で判定する。

export const SHORT_POST_CHARS = 200;
export type LongPostMode = "newline" | "thread";

export const LONG_POST_MODE_FIELD = {
  key: "longPostMode",
  label: "200文字を超える投稿",
  type: "select" as const,
  default: "newline",
  options: [
    { value: "newline", label: "改行ありで1件にまとめる" },
    { value: "thread", label: "ツリー型（返信で連結）に分ける" },
  ],
  help: "200文字以内の投稿は改行を取り除いて1件で投稿します。1件の上限を超える場合は、どちらの設定でも自動でツリーに分けます",
};

/** 見た目の文字数（コードポイント数） */
export const charCount = (s: string) => [...s].length;

const URL_RE = /https?:\/\/[^\s　]+/g;

/**
 * X の文字数（twitter-text の weighted length）。
 * ラテン文字など一部の範囲は1、日本語・絵文字などは2、URL は長さに関係なく23。上限は 280。
 */
export function xLength(text: string): number {
  let n = 0;
  const rest = text.replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const ch of rest) {
    const c = ch.codePointAt(0)!;
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

const isAsciiWord = (ch: string | undefined) => !!ch && /[\x21-\x7e]/.test(ch);

/** 改行を取り除く。英数字どうし（URL の前後など）が隣り合う場合だけ半角スペースでつなぐ */
export function removeLineBreaks(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let out = "";
  for (const line of lines) {
    if (out && (isAsciiWord(out.at(-1)) || isAsciiWord(line[0]))) out += " ";
    out += line;
  }
  return out;
}

/** 1件に入るか */
type Fits = (s: string) => boolean;

/** 文の区切り（句点・感嘆符など）の直後で分ける */
function sentences(line: string): string[] {
  return line.match(/[^。．！？!?]+[。．！？!?」』）)]*|[。．！？!?]+/g) ?? [line];
}

/** どうしても収まらない文は文字単位で切る（URL の途中では切らない） */
function hardSplit(s: string, fits: Fits): string[] {
  const out: string[] = [];
  let cur = "";
  for (const tok of s.split(/(https?:\/\/[^\s　]+)/).flatMap((t) => (/^https?:\/\//.test(t) ? [t] : [...t]))) {
    if (cur && !fits(cur + tok)) {
      out.push(cur);
      cur = "";
    }
    cur += tok;
  }
  if (cur) out.push(cur);
  return out;
}

/** 段落 → 行 → 文 → 文字 の順に、なるべく大きな単位のまま各件に詰める */
export function splitIntoThread(text: string, fits: Fits): string[] {
  const units: { s: string; sep: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (fits(line)) {
      units.push({ s: line, sep: "\n" });
      continue;
    }
    let first = true;
    for (const raw of sentences(line)) {
      const s = raw.trim();
      if (!s) continue;
      const parts = fits(s) ? [s] : hardSplit(s, fits);
      parts.forEach((p, j) => {
        // 行の先頭は改行、文と文の間は英数字どうしのときだけ空白、文字単位で切った続きはそのまま
        const sep = first ? "\n" : j > 0 ? "" : isAsciiWord(units.at(-1)?.s.at(-1)) && isAsciiWord(p[0]) ? " " : "";
        units.push({ s: p, sep });
        first = false;
      });
    }
  }
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    const next = cur ? cur + u.sep + u.s : u.s;
    if (cur && !fits(next)) {
      out.push(cur);
      cur = u.s;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export interface FormatOptions {
  mode: LongPostMode;
  /** 1件の上限（measure で数えた値） */
  limit: number;
  measure: (s: string) => number;
}

/**
 * 投稿本文を整形し、投稿する順に並べた本文の配列を返す（2件以上ならツリー投稿）。
 */
export function formatPostText(text: string, opts: FormatOptions): string[] {
  const within = (s: string) => opts.measure(s) <= opts.limit;
  const flat = removeLineBreaks(text);
  if (charCount(flat) <= SHORT_POST_CHARS) {
    return within(flat) ? [flat] : splitIntoThread(flat, within);
  }
  const body = text.trim();
  if (opts.mode === "thread") {
    return splitIntoThread(body, (s) => within(s) && charCount(s) <= SHORT_POST_CHARS);
  }
  return within(body) ? [body] : splitIntoThread(body, within);
}

/** X の1件の上限（weighted）。無料アカウントは 280（日本語なら約140文字）、X Premium は長文投稿が可能 */
export function xPostLimit(settings: Record<string, unknown>): number {
  return settings.premium === "on" ? 25_000 : 280;
}

export function longPostMode(settings: Record<string, unknown>): LongPostMode {
  return settings.longPostMode === "thread" ? "thread" : "newline";
}
