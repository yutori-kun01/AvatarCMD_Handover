// ================================================
// ログインセッション（署名付きCookie）— middleware(Edge) と API の両方で使う
// ================================================
// 形式: <有効期限(ms)>.<世代>.<HMAC-SHA256(base64url)>
// 署名鍵: SESSION_SECRET（未設定なら ENCRYPTION_KEY から派生）
// 世代（epoch）: パスワード変更・「すべての端末からログアウト」で上がり、それより前に発行したセッションは無効になる

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

export async function createSessionToken(epoch: number, now = Date.now()): Promise<string> {
  const body = `${now + SESSION_TTL_MS}.${epoch}`;
  return `${body}.${await hmac(body)}`;
}

/** 署名・有効期限・世代を確かめる（世代が現在と違えば無効） */
export async function verifySessionToken(token: string | undefined, epoch: number): Promise<boolean> {
  if (!token) return false;
  const [exp, ep, sig] = token.split(".");
  if (!exp || !ep || !sig || !/^\d+$/.test(exp) || !/^\d+$/.test(ep) || Number(exp) < Date.now() || Number(ep) !== epoch) return false;
  const expected = await hmac(`${exp}.${ep}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
