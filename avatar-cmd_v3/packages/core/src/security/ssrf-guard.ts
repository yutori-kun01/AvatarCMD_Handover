// ==============================================
// SSRF Guard — safe outbound fetch for user-supplied URLs
// ==============================================
// Used by the knowledge scraper. Blocks requests to loopback, private,
// link-local (cloud metadata), CGNAT, multicast and reserved ranges.
// The IP check runs inside the socket `lookup`, so the address that is
// validated is the address that is connected to (no DNS-rebinding gap),
// and every redirect hop is re-validated.

import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local / cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0];
  // IPv4-mapped / translated addresses → check the embedded v4 address
  const mapped = lower.match(/^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isBlockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower === "::" || lower === "::1") return true;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return true; // documentation
  return false;
}

/** True if the IP literal must never be contacted. */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // not an IP → treat as unsafe
}

/**
 * Synchronous URL validation (protocol, credentials, literal IPs, ports).
 * Hostnames are additionally checked at connect time by `safeLookup`.
 */
export function assertSafeUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    throw new SsrfError("Invalid URL");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError(`Protocol not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfError("Credentials in URL are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new SsrfError("Missing host");
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new SsrfError(`Blocked address: ${host}`);
  }
  const lowerHost = host.toLowerCase();
  if (lowerHost === "localhost" || lowerHost.endsWith(".localhost") || lowerHost.endsWith(".internal") || lowerHost.endsWith(".local")) {
    throw new SsrfError(`Blocked host: ${host}`);
  }
  const allowedPorts = (process.env.SSRF_ALLOWED_PORTS || "80,443").split(",").map((p) => p.trim());
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!allowedPorts.includes(port)) {
    throw new SsrfError(`Port not allowed: ${port}`);
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** DNS lookup that rejects any resolution to a blocked address. */
export function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || list.length === 0) {
      const e = new SsrfError(`Blocked address for ${hostname}: ${bad?.address ?? "none"}`) as NodeJS.ErrnoException;
      e.code = "ESSRF";
      return callback(e, "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  url: string;
  contentType: string;
  body: string;
  truncated: boolean;
}

function requestOnce(url: URL, opts: Required<Omit<SafeFetchOptions, "maxRedirects">>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean }> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: safeLookup as unknown as net.LookupFunction,
        headers: {
          "User-Agent": "AvatarCMD-KnowledgeBot/3.0 (+https://github.com/)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          ...opts.headers,
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8"), truncated });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (!truncated) resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8"), truncated });
        });
        res.on("error", (e) => {
          if (!truncated) reject(e);
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Request timed out after ${opts.timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetch a user-supplied URL with SSRF protection, size limit, timeout,
 * and per-hop redirect validation.
 */
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    headers: options.headers ?? {},
  };
  const maxRedirects = options.maxRedirects ?? 3;

  let url = assertSafeUrl(input);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(url, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = assertSafeUrl(new URL(res.headers.location, url));
      continue;
    }
    return {
      status: res.status,
      url: url.toString(),
      contentType: String(res.headers["content-type"] || ""),
      body: res.body,
      truncated: res.truncated,
    };
  }
  throw new SsrfError(`Too many redirects (>${maxRedirects})`);
}

/** Crude HTML → text extraction good enough for knowledge snippets. */
export function extractText(html: string, maxChars = 5000): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const decode = (s: string) =>
    s
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const text = decode(
    body
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
  return { title: titleMatch ? decode(titleMatch[1]).trim() : "", text };
}
