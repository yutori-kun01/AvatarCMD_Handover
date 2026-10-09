// ================================================
// Cloudflare R2（S3 互換）— メディアの保存先
// ================================================
// エンドポイント: https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}（パス形式・リージョン auto）
// 認証は AWS Signature Version 4（R2 の API トークンで発行したアクセスキー / シークレット）。
// SDK を入れずに、使う操作（PUT / GET / HEAD / DELETE）だけを署名して送る。
// 参考: https://developers.cloudflare.com/r2/api/s3/api/ ・ https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html

import { createHash, createHmac } from "crypto";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** テスト用にエンドポイントを差し替える（既定は https://{accountId}.r2.cloudflarestorage.com） */
  endpoint?: string;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
/** S3 の URI エンコード（RFC 3986。パスの / はそのまま） */
const encodePath = (p: string) => p.split("/").map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

/**
 * SigV4 の署名ヘッダを作る（ヘッダ方式）。headers には host と x-amz-* を含めて返す。
 * date は "YYYYMMDDTHHMMSSZ"。
 */
export function signV4(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date: string;
}): Record<string, string> {
  const day = input.date.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: input.url.host, "x-amz-date": input.date, "x-amz-content-sha256": input.payloadHash };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const names = Object.keys(lower).sort();
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [input.method, encodePath(decodeURIComponent(input.url.pathname)), query, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", input.date, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

function objectUrl(cfg: R2Config, key: string): URL {
  const base = (cfg.endpoint || `https://${cfg.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
  return new URL(`${base}/${encodeURIComponent(cfg.bucket)}/${encodePath(key)}`);
}

async function send(cfg: R2Config, method: string, key: string, body?: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  const url = objectUrl(cfg, key);
  const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const signed = signV4({
    method,
    url,
    headers,
    payloadHash: sha256(body ?? new Uint8Array()),
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: "auto",
    service: "s3",
    date,
  });
  delete signed.host; // fetch が付ける
  try {
    return await fetch(url, { method, headers: signed, body: body ? Buffer.from(body) : undefined });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    throw new Error(`R2 に接続できませんでした（${url.host}${cause ? `: ${cause}` : ""}）`);
  }
}

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  const hint =
    res.status === 403 || code === "SignatureDoesNotMatch" || code === "InvalidAccessKeyId"
      ? "（アクセスキー・シークレット・権限を確認してください）"
      : code === "NoSuchBucket"
        ? "（バケット名を確認してください）"
        : "";
  throw new Error(`R2: ${what}に失敗しました（${res.status}${code ? ` ${code}` : ""}）${hint}`);
}

export async function r2Put(cfg: R2Config, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const res = await send(cfg, "PUT", key, bytes, { "content-type": contentType });
  if (!res.ok) await fail(res, "アップロード");
}

/** 無ければ null */
export async function r2Get(cfg: R2Config, key: string): Promise<Buffer | null> {
  const res = await send(cfg, "GET", key);
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, "読み込み");
  return Buffer.from(await res.arrayBuffer());
}

export async function r2Exists(cfg: R2Config, key: string): Promise<boolean> {
  const res = await send(cfg, "HEAD", key);
  if (res.status === 404) return false;
  if (!res.ok) await fail(res, "確認");
  return true;
}

export async function r2Delete(cfg: R2Config, key: string): Promise<void> {
  const res = await send(cfg, "DELETE", key);
  if (!res.ok && res.status !== 404) await fail(res, "削除");
}

/** 接続テスト: 小さなファイルを書いて・読んで・消す */
export async function r2Check(cfg: R2Config): Promise<void> {
  const key = `media/.avatar-cmd-check-${Date.now()}.txt`;
  const body = new TextEncoder().encode("ok");
  await r2Put(cfg, key, body, "text/plain");
  const got = await r2Get(cfg, key);
  if (!got || got.toString() !== "ok") throw new Error("R2: 書き込んだファイルを読み戻せませんでした");
  await r2Delete(cfg, key);
}
