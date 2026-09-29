// ================================================
// 投稿本文の整形（X / Threads 共通）
// ================================================
// - 200文字以内: 改行を取り除いて1件で投稿する
// - 200文字超:   アカウント設定 longPostMode に従う
//     newline = 改行を残して1件で投稿（上限を超える分は自動でツリーに分割）
//     thread  = 200文字以内ずつに分けてツリー（返信の連なり）で投稿
// 上限（X の 280 など）はプラットフォームの数え方（measure）で判定する。
// どのプラットフォームでも投稿前に cleanPostText を通す:
// - 「」は必ず取り除く（AI が本文全体や語句を「」で囲んでしまうため）
// - 箇条書きは1項目ずつ改行し、前後の文と空行で分ける（200文字以内でも改行を残す）

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
  help: "200文字以内の投稿は改行を取り除いて1件で投稿します（箇条書きは改行を残します）。1件の上限を超える場合は、どちらの設定でも自動でツリーに分けます",
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

// --- 本文の掃除（「」の除去・箇条書きの改行） ---------------------------------

/** 本文全体を囲んでいる引用符・括弧（AI の出力によくある） */
const WRAPPERS: [string, string][] = [
  ["『", "』"],
  ["“", "”"],
  ['"', '"'],
  ["'", "'"],
  ["【", "】"],
];

/** 「」を取り除く。本文全体を囲む『』や引用符も外す */
export function stripBrackets(text: string): string {
  let t = text.replace(/[「」]/g, "").trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [open, close] of WRAPPERS) {
      // 中に同じ括弧が無い場合だけ外す（『本』と『本』 のような文は残す）
      if (t.length > 2 && t.startsWith(open) && t.endsWith(close) && !t.slice(1, -1).includes(open) && !t.slice(1, -1).includes(close)) {
        t = t.slice(1, -1).trim();
        changed = true;
      }
    }
  }
  return t;
}

/** 箇条書きの行頭記号（・ • ● ◆ ■ ▶ ✅ ✔ - * ①〜⑳ 1. 1) など） */
const BULLET_RE = /^(?:[・•●○◆◇■□▶▷►✅✔☑✓※]|[-*＊]\s|[①-⑳]|\d{1,2}[.．)）]\s?)/;
export const isBulletLine = (line: string) => BULLET_RE.test(line.trim());

/** 2行以上の箇条書きがあるか */
export function hasBulletList(text: string): boolean {
  return text.split(/\r?\n/).filter(isBulletLine).length >= 2;
}

/**
 * 箇条書きを読みやすくする:
 * 1. 行の途中に続けて書かれた項目（「ポイントは3つ。・朝日を浴びる ・水を飲む」「①…②…」）を1項目ずつ改行
 * 2. 箇条書きの前後の文とは空行で分ける
 */
export function formatBullets(text: string): string {
  const split = text
    .split(/\r?\n/)
    .flatMap((line) => {
      // 句読点・コロン・空白の直後の記号、丸数字・●■◆▶✅✔ は行の途中でも項目の区切りとみなす
      // （「コーヒー・紅茶」のような語の間の中黒は区切らない）
      const marked = line
        .replace(/([。！？!?：:）)])\s*(?=[・•●◆■▶✅✔①-⑳])/g, "$1\n")
        .replace(/\s+(?=[・•●◆■▶✅✔①-⑳])/g, "\n")
        .replace(/(?<=\S)(?=[•●◆■▶✅✔①-⑳])/g, "\n");
      return marked.split("\n");
    })
    .map((l) => l.trimEnd());
  if (split.filter(isBulletLine).length < 2) return text.trim();

  const out: string[] = [];
  for (let i = 0; i < split.length; i++) {
    const line = split[i].trim();
    const bullet = isBulletLine(line);
    const prev = out.at(-1);
    if (!line) {
      if (prev !== "" && out.length) out.push("");
      continue;
    }
    // 箇条書きの始まり・終わりは空行を入れる
    if (prev !== undefined && prev !== "" && isBulletLine(prev) !== bullet) out.push("");
    out.push(line);
  }
  while (out.at(-1) === "") out.pop();
  return out.join("\n");
}

/** 投稿前の掃除（全プラットフォーム共通）。article（Markdown の記事）は箇条書きの整形をしない */
export function cleanPostText(text: string, opts: { article?: boolean } = {}): string {
  const t = stripBrackets(text);
  return opts.article ? t : formatBullets(t);
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
export function formatPostText(raw: string, opts: FormatOptions): string[] {
  const text = cleanPostText(raw);
  const within = (s: string) => opts.measure(s) <= opts.limit;
  const flat = removeLineBreaks(text);
  // 箇条書きは200文字以内でも改行を残す（1行につなぐと読めないため）
  if (charCount(flat) <= SHORT_POST_CHARS && !hasBulletList(text)) {
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
