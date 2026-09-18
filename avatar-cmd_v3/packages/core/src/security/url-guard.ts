// ================================================
// @avatar-cmd/core — SSRF Guard
// ================================================
// ナレッジのURL収集機能は任意のURLを受け取るため、
// 内部ネットワーク・クラウドメタデータへの到達を遮断する。
// 計画書「6. セキュリティ対策 / 2. SSRF防御」に対応。

import { lookup } from "dns/promises";
import net from "net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/** 取得を許可するスキーム */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 到達を禁止する IPv4 レンジ (CIDR)。
 * ループバック・プライベート・リンクローカル(=クラウドメタデータ)・
 * CGNAT・マルチキャスト・予約済みを含む。
 */
const BLOCKED_V4_CIDRS: [string, number][] = [
  ["0.0.0.0", 8], // 現在のネットワーク
  ["10.0.0.0", 8], // プライベート
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // ループバック
  ["169.254.0.0", 16], // リンクローカル (169.254.169.254 = メタデータ)
  ["172.16.0.0", 12], // プライベート
  ["192.0.0.0", 24], // IETF プロトコル割当
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // プライベート
  ["198.18.0.0", 15], // ベンチマーク
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // マルチキャスト
  ["240.0.0.0", 4], // 予約済み
];

function v4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const addr = v4ToInt(ip);
  return BLOCKED_V4_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (addr & mask) === (v4ToInt(base) & mask);
  });
}

/**
 * IPv6 アドレスを 8 グループの数値配列に展開する。
 * `::` の省略や IPv4 混在表記 (::ffff:127.0.0.1) も解釈する。
 */
function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0]; // ゾーンIDを除去

  // 末尾が IPv4 ドット表記なら 2 グループの16進に変換しておく
  const dotted = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const hi = (octets[0] << 8) | octets[1];
    const lo = (octets[2] << 8) | octets[3];
    addr =
      addr.slice(0, -dotted[1].length) +
      hi.toString(16) +
      ":" +
      lo.toString(16);
  }

  const [head, tail, ...rest] = addr.split("::");
  if (rest.length > 0) return null; // `::` が複数あるのは不正

  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((g) => parseInt(g, 16));

  const headGroups = parse(head);
  const tailGroups = tail === undefined ? [] : parse(tail);
  if ([...headGroups, ...tailGroups].some((g) => Number.isNaN(g) || g > 0xffff)) {
    return null;
  }

  if (tail === undefined) {
    return headGroups.length === 8 ? headGroups : null;
  }

  const fillLength = 8 - headGroups.length - tailGroups.length;
  if (fillLength < 0) return null;
  return [...headGroups, ...new Array(fillLength).fill(0), ...tailGroups];
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // 解釈できないものは通さない

  const isZeroPrefix = (count: number) => g.slice(0, count).every((x) => x === 0);
  const embeddedV4 = (hi: number, lo: number) =>
    [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");

  // 未指定 (::) / ループバック (::1)
  if (isZeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true;

  // ::ffff:0:0/96 — IPv4射影アドレス
  if (isZeroPrefix(5) && g[5] === 0xffff) {
    return isBlockedV4(embeddedV4(g[6], g[7]));
  }

  // ::/96 — IPv4互換アドレス (非推奨)
  if (isZeroPrefix(6)) {
    return isBlockedV4(embeddedV4(g[6], g[7]));
  }

  // 64:ff9b::/96 — NAT64
  if (
    g[0] === 0x64 &&
    g[1] === 0xff9b &&
    g.slice(2, 6).every((x) => x === 0)
  ) {
    return isBlockedV4(embeddedV4(g[6], g[7]));
  }

  // 2002::/16 — 6to4 (埋め込みIPv4を判定)
  if (g[0] === 0x2002) {
    return isBlockedV4(embeddedV4(g[1], g[2]));
  }

  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 リンクローカル
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 サイトローカル (非推奨)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ユニークローカル
  if (g[0] >> 8 === 0xff) return true; // ff00::/8 マルチキャスト

  return false;
}

/** 単一のIPアドレスが内部向けかどうか */
export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) return isBlockedV6(ip);
  return true; // IPとして解釈できないものは通さない
}

/**
 * URL を検証する。スキーム・ホスト名・名前解決結果のすべてを確認し、
 * 内部アドレスに解決される場合は SsrfBlockedError を投げる。
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`URLの形式が不正です: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(`許可されていないスキームです: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // IPv6リテラルの括弧を除去

  // ホスト名がIPリテラルの場合は名前解決せずにそのまま判定
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfBlockedError(`内部アドレスへのアクセスは禁止されています: ${hostname}`);
    }
    return url;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SsrfBlockedError(`内部ホストへのアクセスは禁止されています: ${hostname}`);
  }

  // 名前解決してすべてのレコードを検証する（DNSリバインディング対策）
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfBlockedError(`ホスト名を解決できません: ${hostname}`);
  }

  if (records.length === 0) {
    throw new SsrfBlockedError(`ホスト名を解決できません: ${hostname}`);
  }

  for (const { address } of records) {
    if (isBlockedAddress(address)) {
      throw new SsrfBlockedError(
        `内部アドレスに解決されるため拒否しました: ${hostname} → ${address}`
      );
    }
  }

  return url;
}

/** 追従を許可するリダイレクトの最大数 */
const MAX_REDIRECTS = 3;

/**
 * SSRF 検証付きの fetch。
 * リダイレクトは手動で追従し、遷移先も毎回検証する。
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  let target = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(target);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    target = new URL(location, url).toString();
  }

  throw new SsrfBlockedError(`リダイレクトが多すぎます: ${rawUrl}`);
}
