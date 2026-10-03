// ================================================
// 外部 AI 用 API の認証・権限・レート制限・二重実行防止・監査ログ
// ================================================
// ・キーの形式: acmd_<prefix 10文字>_<secret 40文字>。平文は発行時に1回だけ返し、DB には HMAC だけを保存する。
// ・権限（scope）は個別に付与する（上位の権限が下位を含むことはしない）:
//     read            … 閲覧（アバター・ナレッジ・ルール・下書き・予約・実行履歴・分析・コスト）
//     draft           … 下書きの作成・AI 生成・削除（公開はしない）
//     publish         … 下書きの承認（予約キューへ）・予約の取り消し
//     rules:write     … 自動化ルールの作成・変更・停止
//     knowledge:write … ナレッジの作成・編集・無効化・差し戻し
// ・操作できるアバターはキーごとに限定できる（allAvatars でない限り avatarIds のみ）。
// ・書き込み系は Idempotency-Key ヘッダー必須。同じキー・同じ本文なら保存済みの応答を返し、本文が違えば 409。
// ・監査ログには本文・Authorization ヘッダー・キーを記録しない。

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";

export const API_SCOPES = ["read", "draft", "publish", "rules:write", "knowledge:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABEL: Record<ApiScope, string> = {
  read: "閲覧",
  draft: "下書きの作成・削除",
  publish: "公開（下書きの承認・予約の取り消し）",
  "rules:write": "自動化ルールの作成・変更",
  "knowledge:write": "ナレッジの作成・編集",
};

/** 1分あたりの上限（キーごと） */
export const RATE_LIMITS = { all: 60, write: 20 };
const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

/** API のエラー（HTTP ステータス付き）。メッセージは利用者に返してよい内容だけを入れる */
export class ApiV1Error extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

function pepper(): string {
  const k = process.env.API_KEY_PEPPER || process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY が未設定です");
  return `api-key:${k}`;
}

export function hashSecret(secret: string): string {
  return createHmac("sha256", pepper()).update(secret).digest("hex");
}

export interface IssueInput {
  name: string;
  scopes: string[];
  avatarIds?: string[];
  allAvatars?: boolean;
  /** 有効期限（日数）。未指定なら無期限 */
  expiresInDays?: number | null;
}

/** キーを発行する。平文のキーは戻り値でだけ返す（再表示できない） */
export async function issueApiKey(input: IssueInput) {
  const name = input.name?.trim();
  if (!name) throw new ConfigError("キーの名前を入力してください");
  const scopes = [...new Set(input.scopes ?? [])];
  if (!scopes.length) throw new ConfigError("権限を1つ以上選択してください");
  for (const s of scopes) if (!API_SCOPES.includes(s as ApiScope)) throw new ConfigError(`不明な権限です: ${s}`);
  const avatarIds = [...new Set(input.avatarIds ?? [])];
  if (!input.allAvatars && !avatarIds.length) throw new ConfigError("操作できるアバターを選択してください（すべてのアバターを許可する場合は明示的に選択）");
  if (avatarIds.length) {
    const found = await prisma.avatar.count({ where: { id: { in: avatarIds } } });
    if (found !== avatarIds.length) throw new ConfigError("存在しないアバターが含まれています");
  }
  const days = input.expiresInDays;
  if (days !== undefined && days !== null && !(Number.isInteger(days) && days > 0 && days <= 3650)) throw new ConfigError("有効期限は 1〜3650 日で指定してください");
  const prefix = randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 10).padEnd(10, "0");
  const secret = randomBytes(30).toString("base64url");
  const row = await prisma.apiKey.create({
    data: {
      name,
      prefix,
      hash: hashSecret(secret),
      scopes,
      avatarIds: input.allAvatars ? [] : avatarIds,
      allAvatars: !!input.allAvatars,
      expiresAt: days ? new Date(Date.now() + days * 86400_000) : null,
    },
  });
  await prisma.auditLog.create({ data: { action: "api_key_issued", resource: "api_key", resourceId: row.id, details: { name, scopes, allAvatars: !!input.allAvatars, avatarIds } } });
  return { id: row.id, key: `acmd_${prefix}_${secret}`, prefix };
}

export async function revokeApiKey(id: string) {
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({ data: { action: "api_key_revoked", resource: "api_key", resourceId: id } });
}

/** 画面表示用（ハッシュは返さない） */
export async function listApiKeys() {
  const rows = await prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(({ hash: _hash, ...r }) => ({ ...r, status: keyStatus(r) }));
}

function keyStatus(k: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): "active" | "revoked" | "expired" {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt && k.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export interface ApiPrincipal {
  id: string;
  name: string;
  scopes: string[];
  avatarIds: string[];
  allAvatars: boolean;
}

/** Authorization: Bearer acmd_<prefix>_<secret> を検証する */
export async function authenticateApiKey(authorization: string | null | undefined): Promise<ApiPrincipal> {
  const m = /^Bearer\s+acmd_([A-Za-z0-9]{10})_([A-Za-z0-9_-]{20,})$/.exec(authorization?.trim() ?? "");
  if (!m) throw new ApiV1Error(401, "unauthorized", "API キーが必要です（Authorization: Bearer acmd_...）");
  const key = await prisma.apiKey.findUnique({ where: { prefix: m[1] } });
  const expected = Buffer.from(key?.hash ?? "0".repeat(64), "hex");
  const actual = Buffer.from(hashSecret(m[2]), "hex");
  const ok = !!key && expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!key || !ok) throw new ApiV1Error(401, "unauthorized", "API キーが正しくありません");
  const st = keyStatus(key);
  if (st !== "active") throw new ApiV1Error(401, "key_" + st, st === "revoked" ? "この API キーは失効しています" : "この API キーは有効期限切れです");
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { id: key.id, name: key.name, scopes: key.scopes, avatarIds: key.avatarIds, allAvatars: key.allAvatars };
}

export function requireScope(p: ApiPrincipal, scope: ApiScope) {
  if (!p.scopes.includes(scope)) throw new ApiV1Error(403, "insufficient_scope", `この操作には権限「${scope}（${API_SCOPE_LABEL[scope]}）」が必要です`);
}

export function canAccessAvatar(p: ApiPrincipal, avatarId: string | null | undefined): boolean {
  return !!avatarId && (p.allAvatars || p.avatarIds.includes(avatarId));
}

export function requireAvatar(p: ApiPrincipal, avatarId: string | null | undefined) {
  // 存在の有無を推測されないよう、権限外も 404 で返す
  if (!canAccessAvatar(p, avatarId)) throw new ApiV1Error(404, "not_found", "対象が見つかりません（このキーで操作できるアバターではない可能性があります）");
}

/** Prisma の where 条件: キーで操作できるアバターに限定する */
export function avatarScope(p: ApiPrincipal): { avatarId?: { in: string[] } } {
  return p.allAvatars ? {} : { avatarId: { in: p.avatarIds } };
}

/** 1分窓のレート制限。超えたら 429 */
export async function checkRateLimit(keyId: string, write: boolean, now = new Date()) {
  const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const buckets: ["all" | "write", number][] = [["all", RATE_LIMITS.all], ...(write ? ([["write", RATE_LIMITS.write]] as ["write", number][]) : [])];
  for (const [bucket, limit] of buckets) {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "api_rate_counters" ("key_id", "bucket", "window", "count") VALUES (${keyId}, ${bucket}, ${window}, 1)
      ON CONFLICT ("key_id", "bucket", "window") DO UPDATE SET "count" = "api_rate_counters"."count" + 1
      RETURNING "count"`;
    if (Number(rows[0]?.count ?? 0) > limit) {
      const retry = Math.max(1, Math.ceil((window.getTime() + 60_000 - now.getTime()) / 1000));
      throw new ApiV1Error(429, "rate_limited", `リクエストが多すぎます（${bucket === "write" ? "書き込み" : "全体"} 1分あたり ${limit} 回まで）`, { "Retry-After": String(retry) });
    }
  }
  // 古い窓は時々掃除する
  if (Math.random() < 0.01) await prisma.apiRateCounter.deleteMany({ where: { window: { lt: new Date(now.getTime() - 3600_000) } } });
}

export function requestHash(method: string, path: string, body: string): string {
  return createHash("sha256").update(`${method}\n${path}\n${body}`).digest("hex");
}

export type IdempotencyStart = { kind: "new"; recordId: string } | { kind: "replay"; status: number; body: unknown };

/** 書き込みの開始時に呼ぶ。同じ Idempotency-Key の処理が既にあれば、結果の再送・衝突を判断する */
export async function beginIdempotent(keyId: string, idemKey: string | null, hash: string, now = new Date()): Promise<IdempotencyStart> {
  if (!idemKey || !/^[A-Za-z0-9_.:-]{8,128}$/.test(idemKey)) {
    throw new ApiV1Error(400, "idempotency_key_required", "書き込みには Idempotency-Key ヘッダー（8〜128文字の英数字・_-.:）が必要です");
  }
  await prisma.idempotencyRecord.deleteMany({ where: { keyId, idemKey, expiresAt: { lt: now } } });
  try {
    const r = await prisma.idempotencyRecord.create({ data: { keyId, idemKey, requestHash: hash, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) } });
    return { kind: "new", recordId: r.id };
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
  }
  const existing = await prisma.idempotencyRecord.findUnique({ where: { keyId_idemKey: { keyId, idemKey } } });
  if (!existing) throw new ApiV1Error(409, "idempotency_conflict", "同じ Idempotency-Key の処理と競合しました。もう一度お試しください");
  if (existing.requestHash !== hash) throw new ApiV1Error(409, "idempotency_mismatch", "この Idempotency-Key は別の内容のリクエストで使用済みです");
  if (existing.status !== "done") throw new ApiV1Error(409, "idempotency_in_progress", "同じリクエストを処理中です。完了後に同じキーで再送すると結果を返します");
  return { kind: "replay", status: existing.responseStatus ?? 200, body: existing.responseBody };
}

/** 結果を保存する（4xx も保存して同じ結果を返す）。予期しない失敗（5xx）は記録を消して再試行できるようにする */
export async function finishIdempotent(recordId: string, status: number, body: unknown) {
  if (status >= 500) {
    await prisma.idempotencyRecord.delete({ where: { id: recordId } }).catch(() => undefined);
    return;
  }
  await prisma.idempotencyRecord.update({ where: { id: recordId }, data: { status: "done", responseStatus: status, responseBody: (body ?? {}) as object } });
}

export async function writeApiAudit(entry: { keyId?: string | null; method: string; path: string; avatarId?: string | null; status: number; idempotencyKey?: string | null; latencyMs?: number; ip?: string | null; error?: string | null }) {
  try {
    await prisma.apiAuditLog.create({
      data: {
        keyId: entry.keyId ?? null,
        method: entry.method,
        // クエリ文字列は記録しない（値に秘密が入る可能性があるため）
        path: entry.path.split("?")[0].slice(0, 300),
        avatarId: entry.avatarId ?? null,
        status: entry.status,
        idempotencyKey: entry.idempotencyKey ?? null,
        latencyMs: entry.latencyMs ?? null,
        ip: entry.ip ?? null,
        error: entry.error ? redact(entry.error).slice(0, 300) : null,
      },
    });
  } catch (e) {
    console.warn("[api-v1] 監査ログの記録に失敗:", e instanceof Error ? e.message : e);
  }
}

/** ログに出す文字列から API キーらしき部分を伏せる */
export function redact(s: string): string {
  return s.replace(/acmd_[A-Za-z0-9]{10}_[A-Za-z0-9_-]+/g, "acmd_***").replace(/Bearer\s+\S+/gi, "Bearer ***");
}

export async function listApiAudit(keyId?: string, take = 100) {
  return prisma.apiAuditLog.findMany({ where: keyId ? { keyId } : {}, orderBy: { createdAt: "desc" }, take });
}
