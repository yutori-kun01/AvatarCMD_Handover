// ================================================
// ログインの試行回数の制限（総当たり対策・サーバー専用）
// ================================================
// ・接続元 IP ごとに、15 分間で 5 回失敗したら 15 分間ログインを受け付けない（成功すると回数を戻す）。
// ・全体でも 15 分間に 30 回を超える失敗があれば、以降の失敗の応答を 3 秒遅らせる（IP を変えながらの総当たり対策）。
//   全体ではロックしない（第三者に管理者を締め出されないため）。
// ・web は 1 プロセスなのでメモリに持つ（再起動で消えるのは許容）。
// ・IP は Traefik が付ける X-Forwarded-For の先頭（直接公開の構成では偽装できるので、全体の遅延が最後の防御になる）。

export const LOGIN_LIMITS = { windowMs: 15 * 60_000, maxPerIp: 5, lockMs: 15 * 60_000, globalSlowAfter: 30, slowMs: 3_000, failMs: 1_000 };

interface Entry {
  fails: number[];
  lockedUntil: number;
}
const byIp = new Map<string, Entry>();
let globalFails: number[] = [];

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** ロック中なら残り秒数、受け付けるなら 0 */
export function lockedFor(ip: string, now = Date.now()): number {
  const e = byIp.get(ip);
  return e && e.lockedUntil > now ? Math.ceil((e.lockedUntil - now) / 1000) : 0;
}

/** 失敗を記録し、失敗の応答を遅らせる時間（ms）を返す */
export function recordFailure(ip: string, now = Date.now()): number {
  const L = LOGIN_LIMITS;
  const e = byIp.get(ip) ?? { fails: [], lockedUntil: 0 };
  e.fails = [...e.fails.filter((t) => now - t < L.windowMs), now];
  if (e.fails.length >= L.maxPerIp) {
    e.lockedUntil = now + L.lockMs;
    e.fails = [];
  }
  byIp.set(ip, e);
  globalFails = [...globalFails.filter((t) => now - t < L.windowMs), now];
  // 古いエントリを掃除（メモリを増やし続けない）
  if (byIp.size > 10_000) for (const [k, v] of byIp) if (v.lockedUntil < now && !v.fails.some((t) => now - t < L.windowMs)) byIp.delete(k);
  return globalFails.length > L.globalSlowAfter ? L.slowMs : L.failMs;
}

export function recordSuccess(ip: string) {
  byIp.delete(ip);
}

/** テスト用 */
export function __resetLoginLimits() {
  byIp.clear();
  globalFails = [];
}
