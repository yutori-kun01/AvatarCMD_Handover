// ================================================
// YouTube チャンネルからの学習 — 新動画の検知 → 本文（文字起こし）の取得 → 要約 → ナレッジ保存
// ================================================
// ・自分のチャンネル・他の人のチャンネルの両方を登録でき、チャンネルとアバターを紐付ける。
// ・新動画の検知: 公開 RSS フィード（https://www.youtube.com/feeds/videos.xml?channel_id=UC...）。API クォータを使わない。
// ・本文の取得:
//     自分のチャンネル … YouTube Data API の captions.list / captions.download（動画の編集権限が必要。
//                         接続した YouTube アカウントに youtube.force-ssl の権限が無い場合は「本文待ち」のまま理由を表示）
//     他の人のチャンネル … 公式 API では字幕の本文を取得できないため、提供された文字起こしを画面・API から登録する。
//                         アクセス制限を回避する取得（非公式の字幕取得など）は行わない。
// ・本文が無い動画は「本文待ち（pending）／取得不可（unavailable）」と表示し、説明文だけで動画全体を要約したことにしない。
// ・フィードが 404 などで読めないとき（YouTube のフィードは一時的に 404 を返すことがある）は、
//   再試行 → アップロード再生リストのフィード → YouTube Data API（playlistItems.list、1 ユニット。接続済みの YouTube アカウントがある場合）の順に切り替える。
// ・同じ動画は二重に取り込まない（チャンネル×動画 ID の一意制約。要約済みなら再要約しない）。
// ・要約はアバターごとに「出典付きの事実」ナレッジとして保存する（出典=動画 URL、取得方法、取得日時、要点ごとの本文の抜粋＝根拠）。

import { prisma } from "@avatar-cmd/db";
import { ApiError, ConfigError, request, requestJson, sleep } from "../http";
import { loadFreshCredentials } from "./accounts";
import { summarizeSourceToKnowledge } from "./learning-summary";
import { errorMessage } from "./publish";
import { recordUsage } from "./usage";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const YT_API = "https://www.googleapis.com/youtube/v3";
/** YouTube Data API のクォータ（ユニット） */
export const YT_QUOTA = { captionsList: 50, captionsDownload: 200, playlistItems: 1 };

export const TRANSCRIPT_STATUS_LABEL: Record<string, string> = {
  pending: "本文待ち",
  available: "本文あり（未要約）",
  summarizing: "要約中",
  summarized: "要約済み",
  unavailable: "取得不可",
};

/** チャンネル ID または /channel/UC... の URL から ID を取り出す（@ハンドルは解決しない） */
export function parseChannelId(input: string): string | null {
  const s = input.trim();
  const m = /(?:^|youtube\.com\/channel\/)(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(s);
  return m ? m[1] : null;
}

export interface FeedEntry {
  videoId: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  description: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** RSS（Atom）フィードの解析 */
export function parseFeed(xml: string): { title: string | null; entries: FeedEntry[] } {
  const title = /<feed[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(xml)?.[1];
  const entries: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const videoId = /<yt:videoId>([\w-]{6,20})<\/yt:videoId>/.exec(e)?.[1];
    if (!videoId) continue;
    const published = /<published>([^<]+)<\/published>/.exec(e)?.[1];
    entries.push({
      videoId,
      title: decode(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? "").trim(),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published) : null,
      description: decode(/<media:description>([\s\S]*?)<\/media:description>/.exec(e)?.[1] ?? "").trim(),
    });
  }
  return { title: title ? decode(title).trim() : null, entries };
}

/** 字幕の環境音などの注記（本文ではないもの） */
const CAPTION_NOISE = /[\[［(（](?:音楽|拍手|笑い|笑|歓声|拍手喝采|効果音|BGM|music|applause|laughter|laughs|cheering|inaudible|♪+)[^\]］)）]{0,20}[\]］)）]|♪+/gi;

/**
 * SRT / VTT から本文だけを取り出す。
 * 自動生成字幕（ASR）の VTT は、前のキューの行を次のキューで繰り返す「流れる表示」になっているため、
 * 直前の行と同じ行・直前の行に含まれる行は捨て、直前の行で始まる行は増えた部分だけを足す。
 */
export function captionsToText(raw: string): string {
  const out: string[] = [];
  let inHeader = false;
  for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const t = line.trim();
    // NOTE / STYLE / REGION ブロックは空行まで読み飛ばす
    if (/^(NOTE|STYLE|REGION)\b/.test(t)) {
      inHeader = true;
      continue;
    }
    if (inHeader) {
      if (!t) inHeader = false;
      continue;
    }
    if (!t || /^\d+$/.test(t) || t.includes("-->") || /^WEBVTT/.test(t) || /^(Kind|Language):/.test(t)) continue;
    const text = t
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(CAPTION_NOISE, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      if (text === prev || prev.endsWith(text)) continue;
      if (text.startsWith(prev)) {
        out[out.length - 1] = text;
        continue;
      }
    }
    out.push(text);
  }
  return out.join("\n");
}

/** 字幕トラックの選び方: 日本語の手動字幕 > 日本語の自動字幕 > 他の言語の手動字幕 > 英語の自動字幕 > その他 */
export function pickCaptionTrack<T extends { snippet: { language?: string; trackKind?: string } }>(tracks: T[]): T | undefined {
  const lang = (t: T) => (t.snippet.language ?? "").toLowerCase();
  const asr = (t: T) => (t.snippet.trackKind ?? "").toLowerCase() === "asr";
  const score = (t: T) => (lang(t).startsWith("ja") ? (asr(t) ? 3 : 4) : asr(t) ? (lang(t).startsWith("en") ? 1 : 0) : 2);
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}

export interface ChannelInput {
  channel?: string;
  ownership?: string;
  avatarIds?: string[];
  ownerAccountId?: string | null;
  enabled?: boolean;
  pollHours?: number;
  lookbackDays?: number;
  maxVideosPerRun?: number;
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

async function validateChannel(b: ChannelInput, existing?: { ownership: string; avatarIds: string[] }) {
  const ownership = (b.ownership ?? existing?.ownership ?? "other") === "own" ? "own" : "other";
  const avatarIds = b.avatarIds !== undefined ? [...new Set(b.avatarIds)] : existing?.avatarIds ?? [];
  if (!avatarIds.length) throw new ConfigError("学んだ内容を入れるアバターを選択してください");
  if ((await prisma.avatar.count({ where: { id: { in: avatarIds } } })) !== avatarIds.length) throw new ConfigError("存在しないアバターが含まれています");
  if (b.ownerAccountId) {
    const acc = await prisma.snsAccount.findUnique({ where: { id: b.ownerAccountId } });
    if (!acc || acc.platform !== "youtube") throw new ConfigError("字幕の取得には、接続済みの YouTube アカウントを選択してください");
  }
  return { ownership, avatarIds };
}

export async function createChannel(b: ChannelInput) {
  const channelId = parseChannelId(b.channel ?? "");
  if (!channelId) throw new ConfigError("チャンネル ID（UC で始まる24文字）または https://www.youtube.com/channel/UC... の URL を入力してください（@ハンドルには未対応）");
  const v = await validateChannel(b);
  if (await prisma.youtubeChannel.findUnique({ where: { channelId } })) throw new ConfigError("このチャンネルは登録済みです");
  return prisma.youtubeChannel.create({
    data: {
      channelId,
      ...v,
      ownerAccountId: v.ownership === "own" ? b.ownerAccountId || null : null,
      enabled: b.enabled ?? true,
      pollHours: clampInt(b.pollHours, 1, 24 * 7, 24),
      lookbackDays: clampInt(b.lookbackDays, 1, 365, 30),
      maxVideosPerRun: clampInt(b.maxVideosPerRun, 1, 20, 3),
    },
  });
}

export async function updateChannel(id: string, b: ChannelInput) {
  const cur = await prisma.youtubeChannel.findUniqueOrThrow({ where: { id } });
  const v = await validateChannel(b, cur);
  return prisma.youtubeChannel.update({
    where: { id },
    data: {
      ...v,
      ...(b.ownerAccountId !== undefined ? { ownerAccountId: v.ownership === "own" ? b.ownerAccountId || null : null } : {}),
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      ...(b.pollHours !== undefined ? { pollHours: clampInt(b.pollHours, 1, 24 * 7, cur.pollHours) } : {}),
      ...(b.lookbackDays !== undefined ? { lookbackDays: clampInt(b.lookbackDays, 1, 365, cur.lookbackDays) } : {}),
      ...(b.maxVideosPerRun !== undefined ? { maxVideosPerRun: clampInt(b.maxVideosPerRun, 1, 20, cur.maxVideosPerRun) } : {}),
    },
  });
}

const FEED_HEADERS = { Accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.8", "User-Agent": "Mozilla/5.0 (compatible; AvatarCMD/3; +https://github.com/)" };
/** 再試行するまでの待ち時間（テストでは 0 にする） */
export const FEED_RETRY = { waitMs: 1500 };

const isRetryable = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 429 || e.status >= 500);

async function readFeed(url: string) {
  const res = await request("youtube", url, { headers: FEED_HEADERS });
  const text = await res.text();
  // 200 でも HTML（同意画面など）が返ることがある
  if (!/<feed[\s>]/.test(text)) throw new ApiError("youtube", 502, text, "youtube: フィードではない応答が返りました");
  return parseFeed(text);
}

/** YouTube Data API でアップロード再生リストを読む（1 ユニット）。接続済みの YouTube アカウントが無ければ null */
async function readUploadsViaApi(ch: { id: string; channelId: string; ownerAccountId: string | null }): Promise<{ title: string | null; entries: FeedEntry[] } | null> {
  const accountId = ch.ownerAccountId ?? (await prisma.snsAccount.findFirst({ where: { platform: "youtube" }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!accountId) return null;
  const { credentials } = await loadFreshCredentials(accountId);
  await recordUsage({ provider: "youtube", purpose: "youtube_api", quotaUnits: YT_QUOTA.playlistItems, requests: 1, context: "youtube", subjectId: ch.id });
  const uploads = `UU${ch.channelId.slice(2)}`;
  const data = await requestJson<{ items?: { snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string; resourceId?: { videoId?: string } }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }>(
    "youtube",
    `${YT_API}/playlistItems?part=snippet,contentDetails&maxResults=15&playlistId=${encodeURIComponent(uploads)}`,
    { headers: { Authorization: `Bearer ${credentials.accessToken}` } }
  );
  const entries: FeedEntry[] = [];
  for (const it of data.items ?? []) {
    const videoId = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
    if (!videoId) continue;
    const published = it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt;
    entries.push({
      videoId,
      title: (it.snippet?.title ?? "").trim(),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published) : null,
      description: (it.snippet?.description ?? "").trim(),
    });
  }
  return { title: data.items?.[0]?.snippet?.channelTitle ?? null, entries };
}

/**
 * チャンネルの新着動画を読む。
 * 1) チャンネルのフィード（404・5xx は一度だけ再試行） 2) アップロード再生リストのフィード 3) YouTube Data API
 */
export async function fetchChannelEntries(ch: { id: string; channelId: string; ownerAccountId: string | null }): Promise<{ title: string | null; entries: FeedEntry[]; via: string }> {
  const errors: string[] = [];
  const channelFeed = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ch.channelId)}`;
  const playlistFeed = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(`UU${ch.channelId.slice(2)}`)}`;
  for (const [via, url, retry] of [["feed", channelFeed, true], ["playlist_feed", playlistFeed, false]] as const) {
    for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
      try {
        return { ...(await readFeed(url)), via };
      } catch (e) {
        if (!isRetryable(e) && !(e instanceof ApiError)) throw e; // 接続できない等は切り替えても同じ
        if (attempt === 0 && retry && isRetryable(e)) {
          await sleep(FEED_RETRY.waitMs);
          continue;
        }
        errors.push(`${via === "feed" ? "フィード" : "再生リストのフィード"}: ${e instanceof ApiError ? e.status : errorMessage(e)}`);
        break;
      }
    }
  }
  try {
    const viaApi = await readUploadsViaApi(ch);
    if (viaApi) return { ...viaApi, via: "data_api" };
    errors.push("Data API: 接続済みの YouTube アカウントがありません");
  } catch (e) {
    errors.push(`Data API: ${e instanceof ApiError ? `${e.status}` : errorMessage(e)}`);
  }
  throw new ConfigError(
    `新しい動画を読み取れませんでした（${errors.join(" / ")}）。チャンネル ID が正しいか（https://www.youtube.com/channel/UC... を開けるか）を確認してください。` +
      "YouTube のフィードが一時的に 404 を返すことがあるため、YouTube アカウントを接続しておくと Data API（1 回 1 ユニット）で代わりに取得します。"
  );
}

/** フィードを読み、対象期間内の新しい動画を登録する（既にある動画は登録しない）。新規件数を返す */
export async function pollChannel(id: string, now = new Date()): Promise<number> {
  const ch = await prisma.youtubeChannel.findUniqueOrThrow({ where: { id } });
  const feed = await fetchChannelEntries(ch);
  const since = now.getTime() - ch.lookbackDays * DAY;
  let added = 0;
  for (const e of feed.entries) {
    if (e.publishedAt && e.publishedAt.getTime() < since) continue;
    const r = await prisma.youtubeVideo.createMany({
      data: [{ channelRowId: ch.id, videoId: e.videoId, url: e.url, title: e.title.slice(0, 300), publishedAt: e.publishedAt, description: e.description.slice(0, 5000) }],
      skipDuplicates: true,
    });
    added += r.count;
  }
  await prisma.youtubeChannel.update({ where: { id }, data: { lastPolledAt: now, lastError: null, ...(feed.title && !ch.title ? { title: feed.title.slice(0, 200) } : {}) } });
  return added;
}

/** 自分のチャンネル: 公式 Captions API で字幕を取得する。取得できなければ理由を残して本文待ち／取得不可にする */
export async function fetchOwnCaptions(videoRowId: string): Promise<boolean> {
  const v = await prisma.youtubeVideo.findUniqueOrThrow({ where: { id: videoRowId }, include: { channel: true } });
  if (v.channel.ownership !== "own" || !v.channel.ownerAccountId) return false;
  if (v.transcriptStatus !== "pending") return v.transcriptStatus === "available" || v.transcriptStatus === "summarized";
  const { credentials } = await loadFreshCredentials(v.channel.ownerAccountId);
  const auth = { Authorization: `Bearer ${credentials.accessToken}` };
  try {
    // クォータは失敗したリクエストでも消費されるため、呼び出す前に記録する
    await recordUsage({ provider: "youtube", purpose: "youtube_api", quotaUnits: YT_QUOTA.captionsList, requests: 1, context: "youtube", subjectId: v.id });
    const list = await requestJson("youtube", `${YT_API}/captions?part=snippet&videoId=${encodeURIComponent(v.videoId)}`, { headers: auth });
    const tracks = (list.items ?? []) as { id: string; snippet: { language?: string; trackKind?: string } }[];
    if (!tracks.length) {
      await prisma.youtubeVideo.update({ where: { id: v.id }, data: { transcriptStatus: "unavailable", error: "字幕トラックがありません（字幕が無い動画は要約しません）" } });
      return false;
    }
    // 日本語の手動字幕を優先（自動生成 ASR より正確）
    const track = pickCaptionTrack(tracks)!;
    await recordUsage({ provider: "youtube", purpose: "youtube_api", quotaUnits: YT_QUOTA.captionsDownload, requests: 1, context: "youtube", subjectId: v.id });
    const res = await request("youtube", `${YT_API}/captions/${encodeURIComponent(track.id)}?tfmt=srt`, { headers: auth });
    const text = captionsToText(await res.text());
    if (!text.trim()) {
      await prisma.youtubeVideo.update({ where: { id: v.id }, data: { transcriptStatus: "unavailable", error: "字幕の本文が空でした" } });
      return false;
    }
    await prisma.youtubeVideo.update({
      where: { id: v.id },
      data: { transcript: text.slice(0, 500_000), transcriptStatus: "available", transcriptMethod: `captions_api${track.snippet.trackKind === "asr" ? "_asr" : ""}`, transcriptAt: new Date(), error: null },
    });
    return true;
  } catch (e) {
    const msg =
      e instanceof ApiError && (e.status === 401 || e.status === 403)
        ? "字幕を取得する権限がありません（動画の編集権限と、YouTube アカウントの youtube.force-ssl 権限での再接続が必要です）"
        : errorMessage(e);
    // 権限・一時的な失敗は「本文待ち」のまま理由を残す（説明文で代用しない）
    await prisma.youtubeVideo.update({ where: { id: v.id }, data: { error: msg.slice(0, 500) } });
    return false;
  }
}

/** 文字起こしを登録する（他の人の動画など。提供された文字起こしのみ） */
export async function submitTranscript(videoRowId: string, transcript: string, by = "human") {
  const text = transcript.trim();
  if (text.length < 50) throw new ConfigError("文字起こしが短すぎます（50文字以上）");
  const v = await prisma.youtubeVideo.findUniqueOrThrow({ where: { id: videoRowId } });
  if (v.transcriptStatus === "summarized") throw new ConfigError("要約済みの動画です（二重に取り込みません）");
  await prisma.youtubeVideo.update({ where: { id: v.id }, data: { transcript: text.slice(0, 500_000), transcriptStatus: "available", transcriptMethod: `manual:${by}`, transcriptAt: new Date(), error: null } });
}

export async function markUnavailable(videoRowId: string, reason: string) {
  await prisma.youtubeVideo.update({ where: { id: videoRowId }, data: { transcriptStatus: "unavailable", error: reason.slice(0, 300) || "取得不可" } });
}

/**
 * 本文（文字起こし）がある動画を要約し、紐付いたアバターごとにナレッジとして保存する。
 * 要点ごとに文字起こしからの抜粋（根拠）を付け、抜粋が本文に無い要点は捨てる。
 */
export async function summarizeVideo(videoRowId: string) {
  const v = await prisma.youtubeVideo.findUniqueOrThrow({ where: { id: videoRowId }, include: { channel: true } });
  if (v.transcriptStatus === "summarized") return v;
  if (v.transcriptStatus !== "available" || !v.transcript) throw new ConfigError("本文（文字起こし）が無い動画は要約しません（本文待ち／取得不可）");
  // 二重要約の防止: available → summarizing を条件付きで確保
  const claimed = await prisma.youtubeVideo.updateMany({ where: { id: v.id, transcriptStatus: "available" }, data: { transcriptStatus: "summarizing" } });
  if (!claimed.count) return prisma.youtubeVideo.findUniqueOrThrow({ where: { id: v.id } });
  try {
    const r = await summarizeSourceToKnowledge({
      noun: "動画",
      materialLabel: "文字起こし",
      title: v.title,
      url: v.url,
      text: v.transcript,
      usageContext: "youtube",
      subjectId: v.id,
      avatarIds: v.channel.avatarIds,
      source: "youtube",
      createdBy: `youtube:${v.videoId}`,
      knowledgeTitle: `動画: ${v.title}`,
      fetchedAt: v.transcriptAt ?? new Date(),
      evidence: { videoId: v.videoId, videoUrl: v.url, method: v.transcriptMethod, transcriptAt: v.transcriptAt?.toISOString() ?? null },
    });
    return prisma.youtubeVideo.update({ where: { id: v.id }, data: { summary: r.summary, summaryEvidence: r.evidence as object, knowledgeIds: r.knowledgeIds, transcriptStatus: "summarized", error: null } });
  } catch (e) {
    await prisma.youtubeVideo.update({ where: { id: v.id }, data: { transcriptStatus: "available", error: errorMessage(e).slice(0, 500) } });
    throw e;
  }
}

/** worker から定期実行: 取得頻度に達したチャンネルのフィードを読み、本文の取得・要約を上限まで行う */
export async function processYoutubeChannels(now = new Date()): Promise<number> {
  const channels = await prisma.youtubeChannel.findMany({ where: { enabled: true } });
  let n = 0;
  for (const ch of channels) {
    if (ch.lastPolledAt && now.getTime() - ch.lastPolledAt.getTime() < ch.pollHours * HOUR) continue;
    try {
      await pollChannel(ch.id, now);
      n++;
      const videos = await prisma.youtubeVideo.findMany({ where: { channelRowId: ch.id, transcriptStatus: { in: ["pending", "available"] } }, orderBy: { publishedAt: "desc" }, take: ch.maxVideosPerRun });
      for (const v of videos) {
        if (v.transcriptStatus === "pending" && ch.ownership === "own") await fetchOwnCaptions(v.id);
        const cur = await prisma.youtubeVideo.findUniqueOrThrow({ where: { id: v.id } });
        if (cur.transcriptStatus === "available" && !cur.error) await summarizeVideo(v.id).catch((e) => console.warn("[youtube] 要約に失敗:", errorMessage(e)));
      }
    } catch (e) {
      await prisma.youtubeChannel.update({ where: { id: ch.id }, data: { lastPolledAt: now, lastError: errorMessage(e).slice(0, 500) } });
    }
  }
  return n;
}
