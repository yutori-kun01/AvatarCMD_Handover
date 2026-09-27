// ================================================
// 投稿用メディアの保存と公開URL
// ================================================
// Instagram / Threads / Facebook などは「公開URLから取り込む」方式のため、
// アップロードされたファイルを MEDIA_DIR に保存し、{appUrl}/media/{name} で公開する。
// web と worker は同じ MEDIA_DIR（Docker ではボリューム）を共有する。

import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import type { MediaFile, SystemConfig } from "../types";

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

const NAME_RE = /^[a-f0-9-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/;

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

export async function saveMedia(bytes: Uint8Array, filename: string, mimeType: string): Promise<MediaRef> {
  const ext = ALLOWED_MEDIA[mimeType];
  if (!ext) throw new Error(`対応していないファイル形式です: ${mimeType}`);
  await mkdir(mediaDir(), { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(mediaDir(), name), bytes);
  return { name, mimeType, size: bytes.byteLength, filename: filename || name };
}

export async function readMedia(name: string): Promise<Buffer> {
  return readFile(mediaPath(name));
}

export async function mediaExists(name: string): Promise<boolean> {
  try {
    await stat(mediaPath(name));
    return true;
  } catch {
    return false;
  }
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
