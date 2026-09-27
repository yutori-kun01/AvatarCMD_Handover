// ================================================
// HTTP / OAuth 共通ユーティリティ
// ================================================
import { createHash, randomBytes } from "crypto";

export class ApiError extends Error {
  constructor(
    public readonly platform: string,
    public readonly status: number,
    public readonly body: string,
    message?: string
  ) {
    super(message ?? `${platform} API error ${status}: ${body.slice(0, 500)}`);
    this.name = "ApiError";
  }
}

/** 利用者が設定を直せば解決するエラー（再試行しても無駄なもの） */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  json?: unknown;
  form?: Record<string, string | undefined>;
}

/** fetch して失敗時は ApiError を投げる。レスポンスは Response のまま返す */
export async function request(platform: string, url: string, opts: RequestOptions = {}): Promise<Response> {
  const { json, form, headers, ...rest } = opts;
  const h = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!h.has("Content-Type")) h.set("Content-Type", "application/json");
  } else if (form) {
    body = new URLSearchParams(clean(form)).toString();
    h.set("Content-Type", "application/x-www-form-urlencoded");
  }
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: h, body });
  } catch (e) {
    throw networkError(platform, url, e);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(platform, res.status, text);
  }
  return res;
}

export function networkError(platform: string, url: string, e: unknown): Error {
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  const detail = cause?.code || cause?.message || (e instanceof Error ? e.message : String(e));
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* noop */
  }
  return new Error(`${platform}: ${host} に接続できません（${detail}）`);
}

export async function requestJson<T = any>(platform: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(platform, url, opts);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function clean(obj: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

export function withQuery(url: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams(clean(params)).toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 条件を満たすまでポーリングする（メディア処理待ち等） */
export async function poll<T>(
  fn: () => Promise<{ done: boolean; value?: T; error?: string }>,
  { intervalMs = 3000, timeoutMs = 10 * 60_000, label = "処理" } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await fn();
    if (r.error) throw new Error(`${label}に失敗しました: ${r.error}`);
    if (r.done) return r.value as T;
    if (Date.now() > deadline) throw new Error(`${label}がタイムアウトしました`);
    await sleep(pollInterval(intervalMs));
  }
}

// テストでポーリング待ちを短縮するためのフック
let intervalScale = 1;
export function __setPollScale(scale: number) {
  intervalScale = scale;
}
function pollInterval(ms: number) {
  return ms * intervalScale;
}

// --- PKCE (RFC 7636, S256) ---
export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/** expires_in (秒) から credentials 用の時刻を作る */
export function tokenTimes(expiresIn?: number | string | null): { expiresAt?: string; issuedAt: string } {
  const now = Date.now();
  const sec = expiresIn == null ? NaN : Number(expiresIn);
  return {
    issuedAt: new Date(now).toISOString(),
    ...(Number.isFinite(sec) && sec > 0 ? { expiresAt: new Date(now + sec * 1000).toISOString() } : {}),
  };
}

/** 失効まで ms 以内か（expiresAt が無ければ false） */
export function expiresWithin(expiresAt: unknown, ms: number): boolean {
  if (typeof expiresAt !== "string") return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t - Date.now() < ms;
}

export function olderThan(issuedAt: unknown, ms: number): boolean {
  if (typeof issuedAt !== "string") return true;
  const t = Date.parse(issuedAt);
  return !Number.isFinite(t) || Date.now() - t > ms;
}

export function requireFields(platform: string, values: Record<string, string>, keys: string[], where: string) {
  const missing = keys.filter((k) => !values[k]);
  if (missing.length) throw new ConfigError(`${platform}: ${where}の ${missing.join(", ")} が未設定です`);
}

export const DAY = 24 * 60 * 60 * 1000;
export const MINUTE = 60 * 1000;

/** タイトル未指定時の自動タイトル（本文1行目） */
export function deriveTitle(post: { title?: string; text: string }, max: number): string {
  const t = (post.title || post.text.split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
