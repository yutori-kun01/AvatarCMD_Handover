// ================================================
// 軽量 Markdown → HTML 変換（WordPress / note 用）
// ================================================
import { randomUUID } from "crypto";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 記事内の目印（HTML コメント）: <!-- paywall --> / <!-- image: 説明 --> / <!-- infographic: 説明 --> */
export const MARKER_RE = /^\s*<!--\s*(paywall|image|infographic)\s*(?::\s*([\s\S]*?))?\s*-->\s*$/;
/** 画像だけの行 */
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/;

/** 本文中の画像の参照先（重複なし、出現順） */
export function markdownImageSources(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) out.add(m[1]);
  return [...out];
}

function inline(src: string, imageAsPlaceholder: boolean): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) =>
    imageAsPlaceholder ? `［画像：${alt || "ここに画像"}］` : `<img src="${url}" alt="${alt}">`
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

const isHr = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isList = (l: string) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
const startsBlock = (l: string) => /^\s*(#{1,6}\s|>|```|~~~|<!--)/.test(l) || isHr(l) || isList(l);

export interface MdOptions {
  /** note 形式（h2/h3 のみ・各要素に name/id 属性・画像は目印に置換） */
  note?: boolean;
  /** note: アップロード済みの画像（本文の参照先 → note の画像 URL）。対応が無い画像は目印になる */
  images?: Record<string, string>;
}

export function markdownToHtml(md: string, opts: MdOptions = {}): string {
  return markdownToNote(md, opts).html;
}

/**
 * Markdown → HTML。note 形式では、有料ラインの目印（<!-- paywall -->）の直後の要素の ID を separator として返す。
 * <!-- image: … --> / <!-- infographic: … --> の目印は、画像がまだ無いので note では「［画像：…］」、それ以外では出力しない。
 */
export function markdownToNote(md: string, opts: MdOptions = {}): { html: string; separator?: string } {
  const note = !!opts.note;
  let pendingPaywall = false;
  let separator: string | undefined;
  const attr = () => {
    if (!note) return "";
    const u = randomUUID();
    if (pendingPaywall) {
      separator = u;
      pendingPaywall = false;
    }
    return ` name="${u}" id="${u}"`;
  };
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const marker = line.match(MARKER_RE);
    if (marker) {
      i++;
      if (marker[1] === "paywall") {
        if (note && separator === undefined) pendingPaywall = true;
      } else if (note) {
        out.push(`<p${attr()}>［${marker[1] === "image" ? "画像" : "図解"}：${esc((marker[2] ?? "").trim() || "ここに画像")}］</p>`);
      }
      continue;
    }
    const img = line.match(IMAGE_LINE_RE);
    if (img && note) {
      const url = opts.images?.[img[2]];
      out.push(
        url
          ? `<figure${attr()}><img src="${esc(url)}" alt="${esc(img[1])}"><figcaption>${img[1] && !/^(image|infographic|eyecatch)$/i.test(img[1]) ? esc(img[1]) : ""}</figcaption></figure>`
          : `<p${attr()}>［画像：${esc(img[1] || "ここに画像")}］</p>`
      );
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i++;
      out.push(`<pre${attr()}${note ? ' class="codeBlock"' : ""}><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const lvl = note ? (h[1].length <= 2 ? 2 : 3) : Math.max(2, h[1].length);
      out.push(`<h${lvl}${attr()}>${inline(h[2], note)}</h${lvl}>`);
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push(`<hr${attr()}>`);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      const paras = buf.join("\n").split(/\n\s*\n/).filter((p) => p.trim());
      const ps = paras.map((p) => `<p${attr()}>${p.split("\n").map((x) => inline(x, note)).join("<br>")}</p>`).join("");
      out.push(note ? `<figure${attr()}><blockquote>${ps}</blockquote><figcaption></figcaption></figure>` : `<blockquote>${ps}</blockquote>`);
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && isList(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
      const tag = ordered ? "ol" : "ul";
      const li = items.map((t) => (note ? `<li><p${attr()}>${inline(t, note)}</p></li>` : `<li>${inline(t, note)}</li>`)).join("");
      out.push(`<${tag}${attr()}>${li}</${tag}>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && startsBlock(lines[i]))) buf.push(lines[i++]);
    out.push(`<p${attr()}>${buf.map((b) => inline(b.trim(), note)).join("<br>")}</p>`);
  }
  return { html: out.join(note ? "" : "\n"), separator };
}

export function htmlTextLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").length;
}
