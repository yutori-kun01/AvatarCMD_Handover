// ==============================================
// Soul Engine — file-based persona definitions
// ==============================================
// Each avatar owns a directory `<AVATAR_DATA_DIR>/<avatarId>/` holding
// soul.md / identity.md / rules.md (+ memory/, artifacts/). In Docker the
// directory is a named volume so edits survive container restarts.
//
// Path-traversal defence: avatar IDs and filenames are validated against
// strict patterns, and every resolved path must stay inside the base dir.

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const EDITABLE_FILES = ["soul.md", "identity.md", "rules.md"] as const;
export type EditableFile = (typeof EDITABLE_FILES)[number];

const AVATAR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_FILE_BYTES = 256 * 1024;

export class SoulEngineError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "SoulEngineError";
  }
}

function findRepoRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Base directory for all avatar files (resolved lazily so env changes apply). */
export function getAvatarsBaseDir(): string {
  if (process.env.AVATAR_DATA_DIR) return path.resolve(process.env.AVATAR_DATA_DIR);
  const root = findRepoRoot(process.cwd());
  return path.join(root ?? process.cwd(), "data", "avatars");
}

export function isValidAvatarId(avatarId: string): boolean {
  return AVATAR_ID_PATTERN.test(avatarId) && avatarId !== "_template";
}

export function isEditableFile(filename: string): filename is EditableFile {
  return (EDITABLE_FILES as readonly string[]).includes(filename);
}

function resolveInside(base: string, ...segments: string[]): string {
  const resolved = path.resolve(base, ...segments);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new SoulEngineError("Path escapes avatar data directory");
  }
  return resolved;
}

export interface AvatarFile {
  filename: string;
  content: string;
  updatedAt: Date;
}

/** Returns the avatar's directory path (validated). */
export function getAvatarDirPath(avatarId: string): string {
  if (!isValidAvatarId(avatarId)) throw new SoulEngineError("Invalid avatar id");
  return resolveInside(getAvatarsBaseDir(), avatarId);
}

function filePath(avatarId: string, filename: string): string {
  if (!isEditableFile(filename)) {
    throw new SoulEngineError(`File not allowed: ${filename}. Allowed: ${EDITABLE_FILES.join(", ")}`);
  }
  return resolveInside(getAvatarDirPath(avatarId), filename);
}

async function readTemplate(name: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path.join(getAvatarsBaseDir(), "_template", name), "utf-8");
  } catch {
    return fallback;
  }
}

/** Create the avatar directory from the template if it does not exist. */
export async function ensureAvatarDirectory(avatarId: string): Promise<void> {
  const dirPath = getAvatarDirPath(avatarId);
  await fs.mkdir(path.join(dirPath, "memory"), { recursive: true });
  await fs.mkdir(path.join(dirPath, "artifacts"), { recursive: true });

  const defaults: Record<EditableFile, [string, string]> = {
    "soul.md": ["soul.md", "# Soul\n\n- Write your persona here.\n"],
    "identity.md": ["identity.md", "# Identity\n\n"],
    "rules.md": ["rules.md", "# Rules\n\n- No hallucination\n"],
  };
  for (const name of EDITABLE_FILES) {
    const p = path.join(dirPath, name);
    if (!existsSync(p)) {
      const [tpl, fallback] = defaults[name];
      await fs.writeFile(p, await readTemplate(tpl, fallback), { encoding: "utf-8", flag: "wx" }).catch(() => {});
    }
  }
}

export async function readAvatarFile(avatarId: string, filename: string): Promise<string | null> {
  const p = filePath(avatarId, filename);
  await ensureAvatarDirectory(avatarId);
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

export async function writeAvatarFile(avatarId: string, filename: string, content: string): Promise<void> {
  const p = filePath(avatarId, filename);
  if (typeof content !== "string") throw new SoulEngineError("content must be a string");
  if (Buffer.byteLength(content, "utf-8") > MAX_FILE_BYTES) {
    throw new SoulEngineError(`File too large (max ${MAX_FILE_BYTES / 1024}KB)`, 413);
  }
  await ensureAvatarDirectory(avatarId);
  // Write atomically: tmp file + rename
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, p);
}

export async function listAvatarFiles(avatarId: string): Promise<AvatarFile[]> {
  await ensureAvatarDirectory(avatarId);
  const result: AvatarFile[] = [];
  for (const filename of EDITABLE_FILES) {
    try {
      const p = filePath(avatarId, filename);
      const [stats, content] = await Promise.all([fs.stat(p), fs.readFile(p, "utf-8")]);
      result.push({ filename, content, updatedAt: stats.mtime });
    } catch {
      // missing file → skip
    }
  }
  return result;
}

/** Remove an avatar's directory (called when the avatar is deleted). */
export async function removeAvatarDirectory(avatarId: string): Promise<void> {
  const dir = getAvatarDirPath(avatarId);
  await fs.rm(dir, { recursive: true, force: true });
}

/** Append a line to the avatar's memory log (memory/YYYY-MM.md). */
export async function appendMemory(avatarId: string, line: string): Promise<void> {
  await ensureAvatarDirectory(avatarId);
  const month = new Date().toISOString().slice(0, 7);
  const p = resolveInside(getAvatarDirPath(avatarId), "memory", `${month}.md`);
  await fs.appendFile(p, `- ${new Date().toISOString()} ${line.replace(/\n/g, " ")}\n`, "utf-8");
}

/**
 * Build the full persona context injected as the LLM system prompt:
 * soul.md + identity.md + rules.md.
 */
export async function buildSoulContext(avatarId: string, fallback = ""): Promise<string> {
  const files = await listAvatarFiles(avatarId);
  const parts = files.map((f) => f.content.trim()).filter(Boolean);
  return parts.length ? parts.join("\n\n---\n\n") : fallback;
}
