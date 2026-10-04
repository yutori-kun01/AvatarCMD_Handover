// RSS フィードからの学習のテスト（単体 + 実 DB）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { claudeSse, mockFetch } from "./helpers";
import { discoverFeedUrl, knownFeedUrl, parseRss } from "../src/service/rss-learning";
import { assertPublicUrl, detectCharset, extractArticle, URL_GUARD } from "../src/service/web-extract";

// テストでは DNS を引かない（example.com 等は公開アドレス、internal.test は内部アドレスとして扱う）
URL_GUARD.resolve = async (host) => (host.endsWith("internal.test") ? ["10.0.0.5"] : ["93.184.215.14"]);

const BODY = "朝の集中を保つには、起きてすぐに窓を開けて光を浴びることが大切です。光を浴びると体内時計が整い、午前中の集中が続きやすくなります。".repeat(4);
const LONG = `<p>${BODY}</p><p>もう一つの習慣は、最初の30分はスマホを見ないことです。これだけで作業に入るまでの時間が短くなります。</p>`.repeat(3);

const RSS2 = (items: { guid: string; title: string; date: string; full?: string; desc?: string; link?: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>集中ブログ &amp; ノート</title>
  <link>https://blog.example.com/</link>
  ${items
    .map(
      (i) => `<item>
    <title>${i.title}</title>
    <link>${i.link ?? `https://blog.example.com/${i.guid}`}</link>
    <guid isPermaLink="false">${i.guid}</guid>
    <pubDate>${i.date}</pubDate>
    <description><![CDATA[${i.desc ?? "<p>抜粋です…</p>"}]]></description>
    ${i.full ? `<content:encoded><![CDATA[${i.full}]]></content:encoded>` : ""}
  </item>`
    )
    .join("\n")}
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom のサイト</title>
  <link rel="alternate" href="https://atom.example.com/"/>
  <link rel="self" href="https://atom.example.com/feed.atom"/>
  <entry>
    <id>tag:atom.example.com,2026:1</id>
    <title type="html">朝の &lt;b&gt;習慣&lt;/b&gt;</title>
    <link rel="alternate" href="https://atom.example.com/posts/1"/>
    <published>2026-10-01T09:00:00+09:00</published>
    <summary>要約だけ</summary>
    <content type="html">&lt;p&gt;本文の段落&lt;/p&gt;&lt;ul&gt;&lt;li&gt;一つ目&lt;/li&gt;&lt;li&gt;二つ目&lt;/li&gt;&lt;/ul&gt;</content>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rdf.example.com/"><title>RDF のサイト</title><link>https://rdf.example.com/</link></channel>
  <item rdf:about="https://rdf.example.com/a/1"><title>RDF 記事</title><link>https://rdf.example.com/a/1</link><dc:date>2026-10-02T00:00:00+09:00</dc:date><description>説明 & 補足</description></item>
</rdf:RDF>`;

const NOTE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>朝の集中｜ゆとり</title></head><body>
<header class="o-navHeader"><a href="/">note</a> ログイン 会員登録</header>
<main><article>
  <h1>朝の集中</h1>
  <div class="p-article__creatorInfo">ゆとり フォロー</div>
  <div class="note-common-styles__textnote-body">${LONG}</div>
  <div class="p-article__action">スキ 123 シェア</div>
  <div class="m-recommend">おすすめの記事 関連する記事 他の人の記事タイトル</div>
</article></main>
<footer class="o-footer">ヘルプ 利用規約</footer>
</body></html>`;

test("RSS 2.0 / Atom / RSS 1.0 を解析する（HTML は段落を保ったテキストにする）", () => {
  const r = parseRss(RSS2([{ guid: "g1", title: "朝の集中 &amp; 習慣", date: "Thu, 01 Oct 2026 00:00:00 +0000", full: LONG }]));
  assert.equal(r.title, "集中ブログ & ノート");
  assert.equal(r.siteUrl, "https://blog.example.com/");
  assert.equal(r.entries[0].guid, "g1");
  assert.equal(r.entries[0].title, "朝の集中 & 習慣");
  assert.equal(r.entries[0].publishedAt?.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(r.entries[0].excerpt, "抜粋です…");
  assert.ok(r.entries[0].content.includes("体内時計が整い") && r.entries[0].content.includes("\n"));

  const a = parseRss(ATOM);
  assert.equal(a.siteUrl, "https://atom.example.com/");
  assert.equal(a.entries[0].url, "https://atom.example.com/posts/1");
  assert.equal(a.entries[0].title, "朝の 習慣");
  assert.equal(a.entries[0].content, "本文の段落\n・一つ目\n・二つ目");
  assert.equal(a.entries[0].excerpt, "要約だけ");

  // & のエスケープ漏れがある RSS 1.0 も読む
  const d = parseRss(RDF);
  assert.equal(d.title, "RDF のサイト");
  assert.equal(d.entries[0].url, "https://rdf.example.com/a/1");
  assert.equal(d.entries[0].excerpt, "説明 & 補足");
  assert.equal(d.entries[0].publishedAt?.toISOString(), "2026-10-01T15:00:00.000Z");

  assert.throws(() => parseRss("<html><body>not a feed</body></html>"), /フィード/);
});

test("フィードの URL を探す（note のクリエイターページ・<link rel=alternate>）", () => {
  assert.equal(knownFeedUrl("https://note.com/yutori_kun"), "https://note.com/yutori_kun/rss");
  assert.equal(knownFeedUrl("https://note.com/yutori_kun/m/mabc123"), "https://note.com/yutori_kun/m/mabc123/rss");
  assert.equal(knownFeedUrl("https://note.com/yutori_kun/n/n123"), null);
  assert.equal(knownFeedUrl("https://blog.example.com/"), null);
  const html = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="stylesheet" href="/a.css"></head></html>';
  assert.equal(discoverFeedUrl(html, "https://blog.example.com/posts/"), "https://blog.example.com/feed/");
  assert.equal(discoverFeedUrl("<html><head></head></html>", "https://blog.example.com/"), null);
});

test("記事ページから本文だけを取り出す（note のスキ・おすすめ・ヘッダー等を除く）", () => {
  const a = extractArticle(NOTE_PAGE, "https://note.com/yutori_kun/n/n123");
  assert.equal(a.method, "readability");
  assert.ok(a.text.includes("体内時計が整い"));
  for (const noise of ["スキ 123", "おすすめの記事", "利用規約", "ログイン", "フォロー"]) assert.ok(!a.text.includes(noise), noise);
});

test("内部ネットワークの URL には接続しない・文字コードを判定する", async () => {
  await assert.rejects(assertPublicUrl("http://localhost:3000/feed"), /内部ネットワーク/);
  await assert.rejects(assertPublicUrl("http://127.0.0.1/feed"), /内部ネットワーク/);
  await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data"), /内部ネットワーク/);
  await assert.rejects(assertPublicUrl("http://[::1]/"), /内部ネットワーク/);
  await assert.rejects(assertPublicUrl("https://wiki.internal.test/feed"), /内部ネットワーク/);
  await assert.rejects(assertPublicUrl("file:///etc/passwd"), /http/);
  assert.equal((await assertPublicUrl("https://blog.example.com/feed")).hostname, "blog.example.com");
  const enc = new TextEncoder();
  assert.equal(detectCharset("text/html; charset=Shift_JIS", enc.encode("")), "shift_jis");
  assert.equal(detectCharset("text/html", enc.encode('<html><head><meta charset="EUC-JP">')), "euc-jp");
  assert.equal(detectCharset(null, enc.encode('<?xml version="1.0" encoding="windows-31j"?>')), "shift_jis");
  assert.equal(detectCharset(null, enc.encode("<html>")), "utf-8");
});

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };
type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
const TOUCHED = ["anthropic_api_key"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const FEED_URL = "https://blog.example.com/feed";
const NOTE_FEED = "https://note.com/yutori_test/rss";

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  await svc.setSetting("anthropic_api_key", "ak-test");
  await prisma.rssFeed.deleteMany({ where: { url: { in: [FEED_URL, NOTE_FEED] } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `rss-${tag}@example.com` } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `RSS-${tag}` } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.rssFeed.deleteMany({ where: { url: { in: [FEED_URL, NOTE_FEED] } } });
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.$disconnect();
});

let pageStatus = 200;

function mocks() {
  const now = Date.now();
  const recent = new Date(now - 86400_000).toUTCString();
  const old = new Date(now - 60 * 86400_000).toUTCString();
  return mockFetch([
    ["GET", /blog\.example\.com\/$/, () => ({ text: '<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head><body>top</body></html>', headers: { "content-type": "text/html" } })],
    ["GET", /blog\.example\.com\/feed$/, () => ({ text: RSS2([{ guid: "full1", title: "全文のある記事", date: recent, full: LONG }, { guid: "old1", title: "古い記事", date: old, full: LONG }]), headers: { "content-type": "application/rss+xml" } })],
    ["GET", /note\.com\/yutori_test\/rss$/, () => ({ text: RSS2([{ guid: "n1", title: "note の記事", date: recent, link: "https://note.com/yutori_test/n/n1" }]).replace("集中ブログ &amp; ノート", "ゆとりのnote"), headers: { "content-type": "application/rss+xml" } })],
    ["GET", /note\.com\/yutori_test\/n\/n1$/, () => (pageStatus === 200 ? { text: NOTE_PAGE, headers: { "content-type": "text/html; charset=utf-8" } } : { status: pageStatus, text: "<!DOCTYPE html><html><title>Service Unavailable</title></html>" })],
    [
      "POST",
      /api\.anthropic\.com\/v1\/messages/,
      (c) => ({
        text: claudeSse(
          c.json.model,
          JSON.stringify({
            summary: "朝に光を浴び、最初の30分はスマホを見ないと午前の集中が続きやすい",
            points: [
              { point: "光で体内時計が整う", quote: "光を浴びると、体内時計が整い、午前中の集中が続きやすくなります" },
              { point: "根拠の無い要点", quote: "この文は本文に無いので捨てられるはず" },
            ],
            tags: ["朝", "集中", "朝"],
          })
        ),
        headers: { "content-type": "text/event-stream" },
      }),
    ],
  ]);
}

test("サイトの URL からフィードを見つけて登録。全文のある記事はそのまま要約してナレッジに保存（対象期間外・重複は取り込まない）", opts, async () => {
  const m = mocks();
  try {
    await assert.rejects(svc.createFeed({ url: "http://localhost/feed", avatarIds: [avatarId] }), /内部ネットワーク/);
    await assert.rejects(svc.createFeed({ url: "https://blog.example.com/", avatarIds: [] }), /アバター/);
    const f = await svc.createFeed({ url: "https://blog.example.com/", avatarIds: [avatarId], lookbackDays: 7 });
    assert.equal(f.url, FEED_URL);
    assert.equal(f.title, "集中ブログ & ノート");
    await assert.rejects(svc.createFeed({ url: FEED_URL, avatarIds: [avatarId] }), /登録済み/);

    assert.equal(await svc.pollFeed(f.id), 1);
    assert.equal(await svc.pollFeed(f.id), 0);
    const a = await prisma.rssArticle.findFirstOrThrow({ where: { feedRowId: f.id } });
    assert.equal(a.status, "available");
    assert.equal(a.contentMethod, "feed");

    const done = await svc.summarizeArticle(a.id);
    assert.equal(done.status, "summarized");
    assert.equal((done.summaryEvidence as any).points.length, 1); // 句読点の違いは許し、本文に無い要点は捨てる
    const k = await prisma.knowledgeItem.findUniqueOrThrow({ where: { id: done.knowledgeIds[0] } });
    assert.equal(k.kind, "fact");
    assert.equal(k.source, "rss");
    assert.equal(k.sourceUrl, "https://blog.example.com/full1");
    assert.equal(k.createdBy, `rss:${a.id}`);
    assert.deepEqual(k.tags, ["朝", "集中"]);
    await svc.summarizeArticle(a.id);
    assert.equal(m.calls.filter((c) => /anthropic/.test(c.url)).length, 1);
    const usage = await prisma.usageLedger.count({ where: { context: "rss", subjectId: a.id } });
    assert.ok(usage >= 1);
  } finally {
    m.restore();
  }
});

test("抜粋しか無い記事（note など）は記事ページから本文を取り出す。取れなければ本文待ち→3回で取得不可。worker で一連の処理", opts, async () => {
  const m = mocks();
  try {
    const f = await svc.createFeed({ url: "https://note.com/yutori_test", avatarIds: [avatarId] });
    assert.equal(f.url, NOTE_FEED);
    await svc.pollFeed(f.id);
    const a = await prisma.rssArticle.findFirstOrThrow({ where: { feedRowId: f.id } });
    assert.equal(a.status, "pending");
    await assert.rejects(svc.summarizeArticle(a.id), /本文/);

    pageStatus = 503;
    assert.equal(await svc.fetchArticleContent(a.id), false);
    let cur = await prisma.rssArticle.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(cur.status, "pending");
    assert.match(cur.error!, /503/);
    assert.doesNotMatch(cur.error!, /DOCTYPE/);

    pageStatus = 200;
    await prisma.rssArticle.update({ where: { id: a.id }, data: { error: null } });
    await prisma.rssFeed.update({ where: { id: f.id }, data: { lastPolledAt: null } });
    assert.ok((await svc.processRssFeeds()) >= 1);
    cur = await prisma.rssArticle.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(cur.status, "summarized");
    assert.equal(cur.contentMethod, "page");
    assert.ok(!cur.content!.includes("おすすめの記事"));

    // 3 回失敗すると取得不可
    pageStatus = 503;
    await prisma.rssArticle.update({ where: { id: a.id }, data: { status: "pending", attempts: 0, content: null } });
    for (let i = 0; i < 3; i++) await svc.fetchArticleContent(a.id);
    cur = await prisma.rssArticle.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(cur.status, "unavailable");
    assert.equal(cur.attempts, 3);

    // 本文の手動登録
    await assert.rejects(svc.submitArticleContent(a.id, "短い"), /短すぎ/);
    await svc.submitArticleContent(a.id, BODY);
    assert.equal((await prisma.rssArticle.findUniqueOrThrow({ where: { id: a.id } })).contentMethod, "manual:human");
  } finally {
    pageStatus = 200;
    m.restore();
  }
});
