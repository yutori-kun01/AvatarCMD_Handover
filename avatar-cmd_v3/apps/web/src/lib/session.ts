// ================================================
// ログインセッションの Cookie（署名付き）— middleware(Edge) と API の両方で使う
// ================================================
// 形式: <有効期限(ms)>.<sid>.<HMAC-SHA256(base64url)>
// ・sid は推測できない乱数。DB には sid のハッシュだけを保存し、失効（ログアウト・パスワード変更）は DB で管理する
//   （admin-security.ts）。middleware（Edge）は DB を見られないので、ここでは署名と期限だけを確かめる。
//   API（route()）では DB のセッションまで確かめる（二重のチェック。lib/guard.ts）。
// ・署名鍵: SESSION_SECRET（未設定なら ENCRYPTION_KEY から派生）

export const SESSION_COOKIE = "acmd_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET || (process.env.ENCRYPTION_KEY ? `session:${process.env.ENCRYPTION_KEY}` : "");
  if (!s) throw new Error("SESSION_SECRET または ENCRYPTION_KEY が未設定です");
  return s;
}

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(sid: string, expiresAt: number): Promise<string> {
  const body = `${expiresAt}.${sid}`;
  return `${body}.${await hmac(body)}`;
}

/** 署名と期限が正しければ sid、そうでなければ null（DB の失効は確かめない） */
export async function readSessionToken(token: string | undefined): Promise<string | null> {
  if (!token || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [exp, sid, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() || !/^[A-Za-z0-9_-]{20,100}$/.test(sid)) return null;
  return safeEqual(await hmac(`${exp}.${sid}`), sig) ? sid : null;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readSessionToken(token)) !== null;
}

/** Cookie ヘッダーから 1 つの値を取り出す */
export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) {
      try {
        return decodeURIComponent(part.slice(i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** 他のサイトからの書き込み（CSRF）を断る。Edge でも Node でも使う */
export function crossSiteWrite(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false; // ブラウザ以外（Cookie が無ければ認証で弾かれる）
  if (origin === "null") return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true;
  }
  const own = [req.headers.get("x-forwarded-host"), req.headers.get("host")].flatMap((h) => (h ? h.split(",").map((x) => x.trim()) : []));
  return !own.includes(host);
}
