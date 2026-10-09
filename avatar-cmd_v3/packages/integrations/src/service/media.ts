// ================================================
// 投稿用メディアの保存と公開URL
// ================================================
// Instagram / Threads / Facebook などは「公開URLから取り込む」方式のため、
// アップロードされたファイルを MEDIA_DIR に保存し、{appUrl}/media/{name} で公開する。
// web と worker は同じ MEDIA_DIR（Docker ではボリューム）を共有する。
// 保存先は「ローカル（MEDIA_DIR）」か「Cloudflare R2」（設定 > システム > メディアの保存先）。
// R2 のときも URL は {appUrl}/media/{name} のまま（web が R2 から読んで返す）。読み込みはローカルにあればローカル、無ければ R2。
// 切り替え前のローカルのファイルは「R2 へ移す」でまとめてアップロードできる（移すまでもローカルから読めるので壊れない）。

import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { ConfigError } from "../http";
import type { MediaFile, SystemConfig } from "../types";
import { r2Check, r2Delete, r2Exists, r2Get, r2Put, type R2Config } from "./r2";
import { getSetting, setSetting, SETTING_KEYS } from "./store";

export interface MediaRef {
  name: string;
  mimeType: string;
  size: number;
  filename: string;
  alt?: string;
}

export const ALLOWED_MEDIA: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** 保存できる形式（投稿の添付に使える ALLOWED_MEDIA ＋ 動画パイプラインのナレーション音声） */
export const STORED_MEDIA: Record<string, string> = {
  ...ALLOWED_MEDIA,
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

const NAME_RE = /^[a-f0-9-]{36}\.(jpg|png|gif|webp|mp4|mov|webm|mp3|wav)$/;

/** web と worker で同じ場所を指すよう、既定はモノレポ直下の data/media */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function mediaDir(): string {
  return path.resolve(process.env.MEDIA_DIR || path.join(workspaceRoot(), "data", "media"));
}

export function mediaPath(name: string): string {
  if (!NAME_RE.test(name)) throw new Error("invalid media name");
  return path.join(mediaDir(), name);
}

// --- 保存先（ローカル / R2） ----------------------------------------------------

export type MediaStorageMode = "local" | "r2";
const r2Key = (name: string) => `media/${name}`;
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(STORED_MEDIA).map(([m, e]) => [e, m]));

/** 設定の読み込みは毎回 DB に行かないよう 30 秒だけ覚えておく（保存したときは消す） */
let cached: { at: number; cfg: R2Config | null } | null = null;
const CACHE_MS = 30_000;

async function readR2Settings(): Promise<{ mode: MediaStorageMode; cfg: Partial<R2Config>; fromEnv: boolean }> {
  const env = process.env;
  if (env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return {
      mode: env.MEDIA_STORAGE === "local" ? "local" : "r2",
      cfg: { accountId: env.R2_ACCOUNT_ID, bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, endpoint: env.R2_ENDPOINT || undefined },
      fromEnv: true,
    };
  }
  const [mode, accountId, bucket, accessKeyId, secretAccessKey] = await Promise.all(
    [SETTING_KEYS.mediaStorage, SETTING_KEYS.r2AccountId, SETTING_KEYS.r2Bucket, SETTING_KEYS.r2AccessKeyId, SETTING_KEYS.r2SecretAccessKey].map((k) => getSetting(k)),
  );
  return { mode: mode === "r2" ? "r2" : "local", cfg: { accountId, bucket, accessKeyId, secretAccessKey }, fromEnv: false };
}

const complete = (c: Partial<R2Config>): c is R2Config => !!(c.accountId && c.bucket && c.accessKeyId && c.secretAccessKey);

/** R2 を使う設定なら接続情報、ローカルなら null。MEDIA_STORAGE=local は DB を見ずにローカル（テスト用） */
export async function mediaStorage(): Promise<R2Config | null> {
  if (process.env.MEDIA_STORAGE === "local" && !process.env.R2_ACCOUNT_ID) return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.cfg;
  let cfg: R2Config | null = null;
  try {
    const s = await readR2Settings();
    cfg = s.mode === "r2" && complete(s.cfg) ? s.cfg : null;
  } catch {
    // DB に届かない（テストなど）ときはローカル
    cfg = null;
  }
  cached = { at: Date.now(), cfg };
  return cfg;
}

export async function saveMedia(bytes: Uint8Array, filename: string, mimeType: string): Promise<MediaRef> {
  const ext = STORED_MEDIA[mimeType];
  if (!ext) throw new Error(`対応していないファイル形式です: ${mimeType}`);
  const name = `${randomUUID()}.${ext}`;
  const r2 = await mediaStorage();
  if (r2) await r2Put(r2, r2Key(name), bytes, mimeType);
  else {
    await mkdir(mediaDir(), { recursive: true });
    await writeFile(path.join(mediaDir(), name), bytes);
  }
  return { name, mimeType, size: bytes.byteLength, filename: filename || name };
}

async function localExists(name: string): Promise<boolean> {
  try {
    await stat(mediaPath(name));
    return true;
  } catch {
    return false;
  }
}

export async function readMedia(name: string): Promise<Buffer> {
  const file = mediaPath(name);
  if (await localExists(name)) return readFile(file);
  const r2 = await mediaStorage();
  const got = r2 ? await r2Get(r2, r2Key(name)) : null;
  if (!got) throw Object.assign(new Error(`メディアが見つかりません: ${name}`), { code: "ENOENT" });
  return got;
}

export async function mediaExists(name: string): Promise<boolean> {
  mediaPath(name); // 名前の検証
  if (await localExists(name)) return true;
  const r2 = await mediaStorage();
  return r2 ? r2Exists(r2, r2Key(name)).catch(() => false) : false;
}

/** ローカルと R2 の両方から消す */
export async function deleteMedia(name: string): Promise<void> {
  await unlink(mediaPath(name)).catch(() => undefined);
  const r2 = await mediaStorage();
  if (r2) await r2Delete(r2, r2Key(name)).catch(() => undefined);
}

/** ローカルに残っているメディア（R2 へ移す前の確認用） */
async function localFiles(): Promise<{ name: string; size: number }[]> {
  let names: string[] = [];
  try {
    names = (await readdir(mediaDir())).filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
  const out: { name: string; size: number }[] = [];
  for (const n of names) {
    const st = await stat(path.join(mediaDir(), n)).catch(() => null);
    if (st?.isFile()) out.push({ name: n, size: st.size });
  }
  return out;
}

export interface MediaStorageInfo {
  mode: MediaStorageMode;
  /** 設定は .env（R2_*）から読んでいる（画面からは変えられない） */
  fromEnv: boolean;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretSet: boolean;
  local: { files: number; bytes: number };
}

export async function describeMediaStorage(): Promise<MediaStorageInfo> {
  const s = await readR2Settings();
  const files = await localFiles();
  const mask = (v?: string) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : "");
  return {
    mode: s.mode,
    fromEnv: s.fromEnv,
    accountId: s.cfg.accountId ?? "",
    bucket: s.cfg.bucket ?? "",
    accessKeyId: mask(s.cfg.accessKeyId),
    secretSet: !!s.cfg.secretAccessKey,
    local: { files: files.length, bytes: files.reduce((a, f) => a + f.size, 0) },
  };
}

/**
 * 保存先の設定。空の項目は今の値のまま（キー・シークレットを毎回入れ直さなくてよい）。
 * R2 に切り替えるときは、書き込み・読み込み・削除を試して通ったときだけ保存する。
 */
export async function saveMediaStorage(input: { mode?: MediaStorageMode; accountId?: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string }): Promise<MediaStorageInfo> {
  const cur = await readR2Settings();
  if (cur.fromEnv) throw new ConfigError("R2 の設定は .env（R2_ACCOUNT_ID など）から読んでいます。変更は .env で行ってください");
  const next: Partial<R2Config> = {
    accountId: input.accountId?.trim() || cur.cfg.accountId,
    bucket: input.bucket?.trim() || cur.cfg.bucket,
    accessKeyId: input.accessKeyId?.trim() || cur.cfg.accessKeyId,
    secretAccessKey: input.secretAccessKey?.trim() || cur.cfg.secretAccessKey,
  };
  if (next.accountId && !/^[a-f0-9]{32}$/i.test(next.accountId)) throw new ConfigError("アカウント ID は Cloudflare ダッシュボードの R2 画面に出る 32 桁の英数字です");
  if (next.bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(next.bucket)) throw new ConfigError("バケット名は小文字の英数字とハイフン（3〜63 文字）です");
  const mode = input.mode ?? cur.mode;
  if (mode === "r2") {
    if (!complete(next)) throw new ConfigError("R2 を使うには、アカウント ID・バケット名・アクセスキー ID・シークレットをすべて入力してください");
    await r2Check(next);
  }
  await Promise.all([
    setSetting(SETTING_KEYS.r2AccountId, next.accountId ?? null),
    setSetting(SETTING_KEYS.r2Bucket, next.bucket ?? null),
    setSetting(SETTING_KEYS.r2AccessKeyId, next.accessKeyId ?? null),
    setSetting(SETTING_KEYS.r2SecretAccessKey, next.secretAccessKey ?? null),
    setSetting(SETTING_KEYS.mediaStorage, mode),
  ]);
  cached = null;
  return describeMediaStorage();
}

/** 接続テストだけ行う（保存はしない） */
export async function testMediaStorage(): Promise<void> {
  const s = await readR2Settings();
  if (!complete(s.cfg)) throw new ConfigError("R2 の接続情報が未入力です");
  await r2Check(s.cfg);
}

/**
 * ローカルのメディアを R2 にアップロードする（1 回に limit 件まで。画面から繰り返し呼ぶ）。
 * deleteLocal なら、R2 にあることを確かめてからローカルのファイルを消す。
 */
export async function migrateMediaToR2(opts: { limit?: number; deleteLocal?: boolean; after?: string } = {}): Promise<{ moved: number; skipped: number; failed: { name: string; error: string }[]; remaining: number; next: string | null }> {
  const r2 = await mediaStorage();
  if (!r2) throw new ConfigError("保存先が R2 になっていません（先に R2 を設定して切り替えてください）");
  // 名前順に after より後ろから（消さない場合も同じファイルを繰り返さない）
  const files = (await localFiles()).sort((a, b) => a.name.localeCompare(b.name)).filter((f) => !opts.after || f.name > opts.after);
  const batch = files.slice(0, Math.max(1, Math.min(500, opts.limit ?? 100)));
  let moved = 0;
  let skipped = 0;
  const failed: { name: string; error: string }[] = [];
  for (const f of batch) {
    try {
      if (await r2Exists(r2, r2Key(f.name))) skipped++;
      else {
        const bytes = await readFile(path.join(mediaDir(), f.name));
        await r2Put(r2, r2Key(f.name), bytes, MIME_BY_EXT[f.name.split(".").pop()!] ?? "application/octet-stream");
        moved++;
      }
      if (opts.deleteLocal) await unlink(path.join(mediaDir(), f.name));
    } catch (e) {
      failed.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const remaining = files.length - batch.length;
  return { moved, skipped, failed, remaining, next: remaining ? batch.at(-1)!.name : null };
}

export function toMediaFile(ref: MediaRef, system: SystemConfig): MediaFile {
  return {
    url: `${system.appUrl}/media/${ref.name}`,
    mimeType: ref.mimeType,
    filename: ref.filename,
    size: ref.size,
    alt: ref.alt,
    load: async () => new Uint8Array(await readMedia(ref.name)),
  };
}
