// ================================================
// RSS フィードからの学習 — 新着記事の検知 → 本文の取得 → 根拠付き要約 → ナレッジ保存
// ================================================
// ・ブログ・ニュース・note（https://note.com/<ユーザー>/rss）などの RSS 2.0 / Atom / RSS 1.0 に対応。
//   サイトの URL を入れた場合は、ページの <link rel="alternate" type="application/rss+xml"> からフィードを探す。
// ・本文: フィードに全文（content:encoded / Atom の content）があればそれを使い、抜粋しか無ければ記事ページから本文だけを抽出する（Readability）。
// ・本文が取れない記事は「本文待ち」のまま理由を表示し（3 回失敗で取得不可）、見出しや抜粋だけで記事全体を要約したことにしない。
// ・同じ記事は二重に取り込まない（フィード×guid の一意制約。要約済みなら再要約しない）。
// ・要約はアバターごとに「出典付きの事実」ナレッジとして保存する（出典=記事 URL、取得方法、取得日時、要点ごとの本文の抜粋＝根拠）。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { summarizeSourceToKnowledge } from "./learning-summary";
import { errorMessage } from "./publish";
import { fetchArticle, fetchPublicText, htmlToText } from "./web-extract";
import { JSDOM, VirtualConsole } from "jsdom";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** フィード内の本文をそのまま使う最低文字数（これより短ければ抜粋とみなし、記事ページから取得する） */
export const FEED_FULLTEXT_MIN = 600;
/** 記事ページから取り出した本文として認める最低文字数 */
export const PAGE_TEXT_MIN = 300;
/** 本文の取得を試す上限（超えたら取得不可） */
const MAX_ATTEMPTS = 3;

export const ARTICLE_STATUS_LABEL: Record<string, string> = {
  pending: "本文待ち",
  available: "本文あり（未要約）",
  summarizing: "要約中",
  summarized: "要約済み",
  unavailable: "取得不可",
};

export interface RssEntry {
  guid: string;
  url: string;
  title: string;
  publishedAt: Date | null;
  /** フィード内の本文（HTML を除いたテキスト） */
  content: string;
  /** フィード内の抜粋（テキスト） */
  excerpt: string;
}

export interface ParsedFeed {
  title: string | null;
  siteUrl: string | null;
  entries: RssEntry[];
}

const parseDate = (s?: string | null) => (s && !Number.isNaN(Date.parse(s.trim())) ? new Date(s.trim()) : null);

function parseXml(xml: string) {
  const make = (s: string) => new JSDOM(s, { contentType: "application/xml", virtualConsole: new VirtualConsole() }).window.document;
  try {
    return make(xml);
  } catch {
    // 実在のフィードでよくある「& のエスケープ漏れ」だけ直して読み直す
    return make(xml.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)/g, "&amp;"));
  }
}

/** RSS 2.0 / Atom / RSS 1.0（RDF）を解析する */
export function parseRss(xml: string): ParsedFeed {
  const doc = parseXml(xml.replace(/^﻿/, "").trim());
  const root = doc.documentElement;
  if (!root || root.getElementsByTagName("parsererror").length) throw new ConfigError("フィード（RSS / Atom）として読めませんでした");
  const name = root.localName.toLowerCase();
  const child = (el: Element, ...tags: string[]) => {
    for (const t of tags) for (const c of Array.from(el.children)) if (c.tagName === t || c.localName === t) return c;
    return null;
  };
  const text = (el: Element, ...tags: string[]) => child(el, ...tags)?.textContent?.trim() ?? "";
  const asText = (s: string) => (/[<&]/.test(s) ? htmlToText(s) : s.trim());

  if (name === "feed") {
    const linkOf = (el: Element) => {
      const links = Array.from(el.children).filter((c) => c.localName === "link");
      const alt = links.find((l) => (l.getAttribute("rel") ?? "alternate") === "alternate") ?? links[0];
      return alt?.getAttribute("href")?.trim() ?? "";
    };
    const entries: RssEntry[] = [];
    for (const e of Array.from(root.children).filter((c) => c.localName === "entry")) {
      const url = linkOf(e);
      if (!url) continue;
      entries.push({
        guid: text(e, "id") || url,
        url,
        title: asText(text(e, "title")),
        publishedAt: parseDate(text(e, "published") || text(e, "updated")),
        content: asText(text(e, "content")),
        excerpt: asText(text(e, "summary")),
      });
    }
    return { title: asText(text(root, "title")) || null, siteUrl: linkOf(root) || null, entries };
  }

  if (name === "rss" || name === "rdf") {
    const channel = child(root, "channel") ?? root;
    const items = name === "rss" ? Array.from(channel.children).filter((c) => c.localName === "item") : Array.from(root.children).filter((c) => c.localName === "item");
    const entries: RssEntry[] = [];
    for (const it of items) {
      const url = text(it, "link") || it.getAttribute("rdf:about") || "";
      if (!/^https?:\/\//.test(url)) continue;
      entries.push({
        guid: text(it, "guid") || it.getAttribute("rdf:about") || url,
        url,
        title: asText(text(it, "title")),
        publishedAt: parseDate(text(it, "pubDate") || text(it, "dc:date", "date")),
        content: asText(text(it, "content:encoded", "encoded")),
        excerpt: asText(text(it, "description")),
      });
    }
    return { title: asText(text(channel, "title")) || null, siteUrl: text(channel, "link") || null, entries };
  }
  throw new ConfigError("フィード（RSS / Atom）ではありません");
}

/** HTML ページからフィードの URL を探す */
export function discoverFeedUrl(html: string, pageUrl: string): string | null {
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole: new VirtualConsole() });
  try {
    const links = Array.from(dom.window.document.querySelectorAll('link[rel~="alternate"][href]')) as HTMLLinkElement[];
    const feed = links.find((l) => /rss\+xml|atom\+xml|rdf\+xml/i.test(l.type)) ?? links.find((l) => /\/(feed|rss)(\.xml)?\/?$|\.rdf$|\.atom$/i.test(l.href));
    return feed ? new URL(feed.getAttribute("href")!, pageUrl).href : null;
  } finally {
    dom.window.close();
  }
}

/** よく使うサイトは URL からフィードを決める（note のクリエイターページ → /rss） */
export function knownFeedUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (/(^|\.)note\.com$/.test(u.hostname)) {
      const m = /^\/([\w-]+)\/?$/.exec(u.pathname);
      if (m && !["n", "hashtag", "search", "topic"].includes(m[1])) return `https://note.com/${m[1]}/rss`;
      const mag = /^\/([\w-]+)\/m\/([\w-]+)\/?$/.exec(u.pathname);
      if (mag) return `https://note.com/${mag[1]}/m/${mag[2]}/rss`;
    }
  } catch {
    /* noop */
  }
  return null;
}

/** 入力された URL（フィードかサイト）からフィードを解決して読む */
export async function resolveFeed(input: string): Promise<{ url: string; feed: ParsedFeed }> {
  const url = knownFeedUrl(input.trim()) ?? input.trim();
  const res = await fetchPublicText("rss", url, "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1");
  if (/<(rss|feed|rdf:RDF)[\s>]/.test(res.text.slice(0, 5000))) return { url: res.url, feed: parseRss(res.text) };
  const found = discoverFeedUrl(res.text, res.url);
  if (!found) throw new ConfigError("この URL からフィード（RSS / Atom）が見つかりませんでした。フィードの URL（…/feed、…/rss など）を入力してください");
  const res2 = await fetchPublicText("rss", found, "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.1");
  return { url: res2.url, feed: parseRss(res2.text) };
}

export interface FeedInput {
  url?: string;
  avatarIds?: string[];
  enabled?: boolean;
  pollHours?: number;
  lookbackDays?: number;
  maxItemsPerRun?: number;
  fetchFullText?: boolean;
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

async function validateAvatars(ids: string[] | undefined, existing?: string[]) {
  const avatarIds = ids !== undefined ? [...new Set(ids)] : existing ?? [];
  if (!avatarIds.length) throw new ConfigError("学んだ内容を入れるアバターを選択してください");
  if ((await prisma.avatar.count({ where: { id: { in: avatarIds } } })) !== avatarIds.length) throw new ConfigError("存在しないアバターが含まれています");
  return avatarIds;
}

export async function createFeed(b: FeedInput) {
  if (!b.url?.trim()) throw new ConfigError("フィードかサイトの URL を入力してください");
  const avatarIds = await validateAvatars(b.avatarIds);
  const { url, feed } = await resolveFeed(b.url);
  if (await prisma.rssFeed.findUnique({ where: { url } })) throw new ConfigError("このフィードは登録済みです");
  return prisma.rssFeed.create({
    data: {
      url,
      title: feed.title?.slice(0, 200) ?? null,
      siteUrl: feed.siteUrl?.slice(0, 500) ?? null,
      avatarIds,
      enabled: b.enabled ?? true,
      pollHours: clampInt(b.pollHours, 1, 24 * 7, 6),
      lookbackDays: clampInt(b.lookbackDays, 1, 90, 7),
      maxItemsPerRun: clampInt(b.maxItemsPerRun, 1, 20, 3),
      fetchFullText: b.fetchFullText ?? true,
    },
  });
}

export async function updateFeed(id: string, b: FeedInput) {
  const cur = await prisma.rssFeed.findUniqueOrThrow({ where: { id } });
  const avatarIds = await validateAvatars(b.avatarIds, cur.avatarIds);
  return prisma.rssFeed.update({
    where: { id },
    data: {
      avatarIds,
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      ...(b.fetchFullText !== undefined ? { fetchFullText: b.fetchFullText } : {}),
      ...(b.pollHours !== undefined ? { pollHours: clampInt(b.pollHours, 1, 24 * 7, cur.pollHours) } : {}),
      ...(b.lookbackDays !== undefined ? { lookbackDays: clampInt(b.lookbackDays, 1, 90, cur.lookbackDays) } : {}),
      ...(b.maxItemsPerRun !== undefined ? { maxItemsPerRun: clampInt(b.maxItemsPerRun, 1, 20, cur.maxItemsPerRun) } : {}),
    },
  });
}

/** フィードを読み、対象期間内の新しい記事を登録する（既にある記事は登録しない）。新規件数を返す */
export async function pollFeed(id: string, now = new Date()): Promise<number> {
  const f = await prisma.rssFeed.findUniqueOrThrow({ where: { id } });
  const res = await fetchPublicText("rss", f.url, "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1");
  const feed = parseRss(res.text);
  const since = now.getTime() - f.lookbackDays * DAY;
  let added = 0;
  // 公開日が無い記事もあるため、1 回に見るのはフィードの先頭（新しい順）50 件まで
  for (const e of feed.entries.slice(0, 50)) {
    if (e.publishedAt && e.publishedAt.getTime() < since) continue;
    if (e.publishedAt && e.publishedAt.getTime() > now.getTime() + DAY) continue;
    const hasFull = e.content.length >= FEED_FULLTEXT_MIN;
    const r = await prisma.rssArticle.createMany({
      data: [
        {
          feedRowId: f.id,
          guid: e.guid.slice(0, 1000),
          url: e.url.slice(0, 2000),
          title: (e.title || e.url).slice(0, 300),
          publishedAt: e.publishedAt,
          excerpt: (e.excerpt || e.content).slice(0, 2000) || null,
          ...(hasFull ? { status: "available", content: e.content.slice(0, 500_000), contentMethod: "feed", contentAt: now } : {}),
        },
      ],
      skipDuplicates: true,
    });
    added += r.count;
  }
  await prisma.rssFeed.update({
    where: { id },
    data: { lastPolledAt: now, lastError: null, ...(feed.title && !f.title ? { title: feed.title.slice(0, 200) } : {}), ...(feed.siteUrl && !f.siteUrl ? { siteUrl: feed.siteUrl.slice(0, 500) } : {}) },
  });
  return added;
}

/** 記事ページから本文を取り出す。取れなければ理由を残して本文待ち（上限回数で取得不可）にする */
export async function fetchArticleContent(articleId: string): Promise<boolean> {
  const a = await prisma.rssArticle.findUniqueOrThrow({ where: { id: articleId }, include: { feed: true } });
  if (a.status !== "pending") return a.status === "available" || a.status === "summarized";
  const attempts = a.attempts + 1;
  const fail = async (msg: string, permanent = false) => {
    const giveUp = permanent || attempts >= MAX_ATTEMPTS;
    await prisma.rssArticle.update({ where: { id: a.id }, data: { attempts, error: msg.slice(0, 500), ...(giveUp ? { status: "unavailable" } : {}) } });
    return false;
  };
  if (!a.feed.fetchFullText) return fail("フィードに全文が無く、記事ページからの取得はオフです（設定で「記事ページから本文を取得」をオンにするか、本文を登録してください）", true);
  try {
    const page = await fetchArticle(a.url);
    if (page.text.length < PAGE_TEXT_MIN) return fail(`記事ページから本文を取り出せませんでした（${page.text.length} 文字。会員限定・動画中心のページなど）`);
    await prisma.rssArticle.update({
      where: { id: a.id },
      data: { content: page.text.slice(0, 500_000), status: "available", contentMethod: page.method === "readability" ? "page" : "page_body", contentAt: new Date(), attempts, error: null },
    });
    return true;
  } catch (e) {
    return fail(errorMessage(e), e instanceof ConfigError);
  }
}

/** 本文を登録する（会員限定記事などで、利用してよい本文を手で入れる場合） */
export async function submitArticleContent(articleId: string, content: string, by = "human") {
  const text = content.trim();
  if (text.length < 100) throw new ConfigError("本文が短すぎます（100文字以上）");
  const a = await prisma.rssArticle.findUniqueOrThrow({ where: { id: articleId } });
  if (a.status === "summarized") throw new ConfigError("要約済みの記事です（二重に取り込みません）");
  await prisma.rssArticle.update({ where: { id: a.id }, data: { content: text.slice(0, 500_000), status: "available", contentMethod: `manual:${by}`, contentAt: new Date(), error: null } });
}

export async function markArticleUnavailable(articleId: string, reason: string) {
  await prisma.rssArticle.update({ where: { id: articleId }, data: { status: "unavailable", error: reason.slice(0, 300) || "取得不可" } });
}

/** 本文がある記事を要約し、紐付いたアバターごとにナレッジとして保存する */
export async function summarizeArticle(articleId: string) {
  const a = await prisma.rssArticle.findUniqueOrThrow({ where: { id: articleId }, include: { feed: true } });
  if (a.status === "summarized") return a;
  if (a.status !== "available" || !a.content) throw new ConfigError("本文が無い記事は要約しません（本文待ち／取得不可）");
  const claimed = await prisma.rssArticle.updateMany({ where: { id: a.id, status: "available" }, data: { status: "summarizing" } });
  if (!claimed.count) return prisma.rssArticle.findUniqueOrThrow({ where: { id: a.id } });
  try {
    const r = await summarizeSourceToKnowledge({
      noun: "記事",
      materialLabel: "本文",
      title: a.title,
      url: a.url,
      text: a.content,
      usageContext: "rss",
      subjectId: a.id,
      avatarIds: a.feed.avatarIds,
      source: "rss",
      createdBy: `rss:${a.id}`,
      knowledgeTitle: `記事: ${a.title}`,
      fetchedAt: a.contentAt ?? new Date(),
      evidence: { articleId: a.id, feed: a.feed.title ?? a.feed.url, method: a.contentMethod, publishedAt: a.publishedAt?.toISOString() ?? null },
    });
    return prisma.rssArticle.update({ where: { id: a.id }, data: { summary: r.summary, summaryEvidence: r.evidence as object, knowledgeIds: r.knowledgeIds, status: "summarized", error: null } });
  } catch (e) {
    await prisma.rssArticle.update({ where: { id: a.id }, data: { status: "available", error: errorMessage(e).slice(0, 500) } });
    throw e;
  }
}

/** worker から定期実行: 取得頻度に達したフィードを読み、本文の取得・要約を上限まで行う */
export async function processRssFeeds(now = new Date()): Promise<number> {
  const feeds = await prisma.rssFeed.findMany({ where: { enabled: true } });
  let n = 0;
  for (const f of feeds) {
    if (f.lastPolledAt && now.getTime() - f.lastPolledAt.getTime() < f.pollHours * HOUR) continue;
    try {
      await pollFeed(f.id, now);
      n++;
      const items = await prisma.rssArticle.findMany({ where: { feedRowId: f.id, status: { in: ["pending", "available"] } }, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: f.maxItemsPerRun });
      for (const it of items) {
        if (it.status === "pending") await fetchArticleContent(it.id);
        const cur = await prisma.rssArticle.findUniqueOrThrow({ where: { id: it.id } });
        if (cur.status === "available" && !cur.error) await summarizeArticle(it.id).catch((e) => console.warn("[rss] 要約に失敗:", errorMessage(e)));
      }
    } catch (e) {
      await prisma.rssFeed.update({ where: { id: f.id }, data: { lastPolledAt: now, lastError: errorMessage(e).slice(0, 500) } });
    }
  }
  return n;
}
