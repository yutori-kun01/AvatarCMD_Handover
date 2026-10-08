// ================================================
// Web ページの取得と本文抽出（RSS 学習で使う）
// ================================================
// ・取得先は利用者が登録した URL なので、内部ネットワーク（localhost・プライベート IP・メタデータ IP 等）には接続しない（SSRF 対策）。
//   リダイレクトも 1 回ずつ確認する。
// ・本文の抽出は Mozilla Readability（Firefox のリーダー表示と同じ仕組み）。
//   note.com はスキボタン・関連記事・クリエイター情報などが本文と誤認されやすいので、先に取り除く（以前の URL 抽出システムの知見）。
// ・Shift_JIS / EUC-JP のサイトも文字化けしないよう、Content-Type と <meta charset> から文字コードを判定する。

import { lookup } from "dns/promises";
import { isIP } from "net";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ApiError, ConfigError, networkError } from "../http";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 AvatarCMD/3";

/** テストで DNS を引かないための差し替え口 */
export const URL_GUARD = {
  resolve: async (host: string): Promise<string[]> => (await lookup(host, { all: true })).map((a) => a.address),
};

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** http(s) で、公開されたホストか確認する */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConfigError(`URL が正しくありません: ${raw.slice(0, 200)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ConfigError("http:// か https:// の URL を指定してください");
  if (u.username || u.password) throw new ConfigError("ユーザー名・パスワード付きの URL は使えません");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new ConfigError("内部ネットワークの URL には接続しません");
  const addrs = isIP(host) ? [host] : await URL_GUARD.resolve(host).catch(() => [] as string[]);
  if (!addrs.length) throw new ConfigError(`${host} が見つかりません（URL を確認してください）`);
  if (addrs.some(isPrivateAddress)) throw new ConfigError("内部ネットワークの URL には接続しません");
  return u;
}

export function detectCharset(contentType: string | null, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  const ascii = new TextDecoder("latin1").decode(head.slice(0, 4096));
  const fromDoc = /<meta[^>]+charset=["']?([\w-]+)/i.exec(ascii)?.[1] ?? /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(ascii)?.[1];
  const cs = (fromHeader ?? fromDoc ?? "utf-8").toLowerCase();
  const map: Record<string, string> = { sjis: "shift_jis", "x-sjis": "shift_jis", "shift-jis": "shift_jis", "windows-31j": "shift_jis", cp932: "shift_jis", "x-euc-jp": "euc-jp" };
  return map[cs] ?? cs;
}

export interface FetchedText {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

/** 公開 URL だけを取得する（リダイレクトはホストを確認しながら追う。サイズ・時間の上限あり） */
export async function fetchPublicText(platform: string, raw: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"): Promise<FetchedText> {
  let url = raw;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const u = await assertPublicUrl(url);
    let res: Response;
    try {
      res = await fetch(u.href, { redirect: "manual", headers: { "User-Agent": BROWSER_UA, Accept: accept, "Accept-Language": "ja,en;q=0.8" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw networkError(platform, u.href, e);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, u.href).href;
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new ConfigError(`ページが大きすぎます（${Math.round(buf.byteLength / 1024 / 1024)}MB）`);
    const contentType = res.headers.get("content-type") ?? "";
    let text: string;
    try {
      text = new TextDecoder(detectCharset(contentType, buf)).decode(buf);
    } catch {
      text = new TextDecoder("utf-8").decode(buf);
    }
    if (!res.ok) throw new ApiError(platform, res.status, text);
    return { url: u.href, status: res.status, contentType, text };
  }
  throw new ConfigError("リダイレクトが多すぎます");
}

const quietConsole = () => new VirtualConsole();

const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE", "PRE", "UL", "OL", "LI", "TR", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "HR"]);

/** HTML（断片可）を段落の区切りを残したプレーンテキストにする */
export function htmlToText(html: string): string {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { virtualConsole: quietConsole() });
  const doc = dom.window.document;
  doc.querySelectorAll("script,style,noscript,iframe,svg,button,form").forEach((el) => el.remove());
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) parts.push(child.textContent ?? "");
      else if (child.nodeType === 1) {
        const el = child as Element;
        if (el.tagName === "BR") {
          parts.push("\n");
          continue;
        }
        const block = BLOCK.has(el.tagName);
        if (block) parts.push("\n");
        if (el.tagName === "LI") parts.push("・");
        walk(el);
        if (block) parts.push("\n");
      }
    }
  };
  walk(doc.body);
  const text = parts
    .join("")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  dom.window.close();
  return text;
}

/** note.com で本文と誤認されやすい要素 */
const NOTE_NOISE = [".o-navHeader", ".o-footer", ".p-article__creatorInfo", ".p-article__action", ".p-article__remarkArea", ".o-noteContentHeader__info", ".m-recommend", ".o-magazineList", "[data-note-ad]", "nav", "footer", "aside"];
const GENERIC_NOISE = ["nav", "footer", "aside", "header nav", ".sidebar", "#sidebar", ".ads", ".ad", ".advertisement", ".comments", "#comments", ".share", ".sns-share", ".related", ".related-posts", ".breadcrumb", "[role=navigation]", "[aria-hidden=true]"];

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  text: string;
  /** readability / body（Readability が本文を見つけられず body 全体を使った） */
  method: "readability" | "body";
}

/** 記事ページの HTML から本文だけを取り出す */
export function extractArticle(html: string, url: string): ExtractedArticle {
  const dom = new JSDOM(html, { url, virtualConsole: quietConsole() });
  const doc = dom.window.document;
  try {
    const host = new URL(url).hostname;
    const noise = /(^|\.)note\.com$/.test(host) ? NOTE_NOISE : GENERIC_NOISE;
    for (const sel of noise) doc.querySelectorAll(sel).forEach((el) => el.remove());
    const article = new Readability(doc, { charThreshold: 300 }).parse();
    if (article?.content) {
      return { title: article.title?.trim() || null, byline: article.byline?.trim() || null, text: htmlToText(article.content), method: "readability" };
    }
    return { title: doc.title?.trim() || null, byline: null, text: htmlToText(doc.body?.innerHTML ?? ""), method: "body" };
  } finally {
    dom.window.close();
  }
}

/** 記事ページを取得して本文を取り出す */
export async function fetchArticle(url: string): Promise<ExtractedArticle & { finalUrl: string }> {
  const page = await fetchPublicText("rss", url);
  if (!/html|xml/i.test(page.contentType) && !/^\s*</.test(page.text)) throw new ConfigError(`記事ページではありません（${page.contentType || "不明な形式"}）`);
  return { ...extractArticle(page.text, page.url), finalUrl: page.url };
}
