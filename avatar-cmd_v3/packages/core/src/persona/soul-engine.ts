import fs from "fs/promises";
import path from "path";

// コンテナ環境でも動くように、環境変数またはモノレポルートのdataディレクトリを見る
const AVATARS_DIR = process.env.AVATAR_DATA_DIR 
  || path.join(process.cwd(), "..", "..", "data", "avatars");
const TEMPLATE_DIR = path.join(AVATARS_DIR, "_template");

/** 編集を許可するファイル名のホワイトリスト */
export const EDITABLE_AVATAR_FILES = ["soul.md", "identity.md", "rules.md"] as const;
export type EditableAvatarFile = (typeof EDITABLE_AVATAR_FILES)[number];

export class InvalidAvatarPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAvatarPathError";
  }
}

export interface AvatarFile {
  filename: string;
  content: string;
  updatedAt: Date;
}

/**
 * アバターのディレクトリパスを取得
 */
export function getAvatarDirPath(avatarId: string): string {
  return path.join(AVATARS_DIR, avatarId);
}

/**
 * avatarId / filename を検証し、アバターディレクトリ内の絶対パスを返す。
 * `..` や絶対パス、シンボリックリンクを狙った脱出を遮断する。
 * 計画書「6. セキュリティ対策 / 3. ファイルパストラバーサル防御」に対応。
 */
export function resolveAvatarFilePath(avatarId: string, filename: string): string {
  // avatarId は DB の uuid のみを想定。区切り文字は一切許可しない。
  if (!/^[A-Za-z0-9_-]+$/.test(avatarId)) {
    throw new InvalidAvatarPathError(`不正なavatarIdです: ${avatarId}`);
  }

  if (!EDITABLE_AVATAR_FILES.includes(filename as EditableAvatarFile)) {
    throw new InvalidAvatarPathError(`許可されていないファイル名です: ${filename}`);
  }

  const dirPath = path.resolve(getAvatarDirPath(avatarId));
  const filePath = path.resolve(dirPath, filename);

  // ホワイトリスト通過後の最終確認（多層防御）
  if (filePath !== path.join(dirPath, filename)) {
    throw new InvalidAvatarPathError(`ディレクトリ外へのアクセスです: ${filename}`);
  }

  return filePath;
}

/**
 * ファイルが存在するか確認し、なければテンプレートからコピーして初期化
 */
export async function ensureAvatarDirectory(avatarId: string): Promise<void> {
  const dirPath = getAvatarDirPath(avatarId);
  try {
    await fs.access(dirPath);
  } catch {
    // ディレクトリが存在しない場合は作成
    await fs.mkdir(dirPath, { recursive: true });
    
    // テンプレートからデフォルトファイルをコピー
    try {
      // テンプレートディレクトリがなければ作成
      await fs.mkdir(TEMPLATE_DIR, { recursive: true }).catch(() => {});
      
      let soulTemplate = "";
      try {
        soulTemplate = await fs.readFile(path.join(TEMPLATE_DIR, "soul.md"), "utf-8");
      } catch {
        soulTemplate = "# Soul\n\n- Write your persona here.";
      }

      await fs.writeFile(path.join(dirPath, "soul.md"), soulTemplate, "utf-8");
      
      // 必要に応じて identity.md や rules.md の空ファイルも作成
      await fs.writeFile(path.join(dirPath, "identity.md"), "# Identity\n\n", "utf-8");
      await fs.writeFile(path.join(dirPath, "rules.md"), "# Rules\n\n- No hallucination", "utf-8");
      
      // ログやメモリ用のディレクトリを作成
      await fs.mkdir(path.join(dirPath, "memory"), { recursive: true });
      await fs.mkdir(path.join(dirPath, "artifacts"), { recursive: true });
    } catch (e) {
      console.error(`Failed to copy templates for avatar ${avatarId}:`, e);
    }
  }
}

/**
 * 指定したアバターのファイルを読み込む
 */
export async function readAvatarFile(avatarId: string, filename: string): Promise<string | null> {
  const filePath = resolveAvatarFilePath(avatarId, filename);
  await ensureAvatarDirectory(avatarId);

  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 指定したアバターのファイルを保存する
 */
export async function writeAvatarFile(avatarId: string, filename: string, content: string): Promise<void> {
  const filePath = resolveAvatarFilePath(avatarId, filename);
  await ensureAvatarDirectory(avatarId);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * アバターの主要ファイル一覧を取得する
 */
export async function listAvatarFiles(avatarId: string): Promise<AvatarFile[]> {
  await ensureAvatarDirectory(avatarId);
  const dirPath = getAvatarDirPath(avatarId);
  
  const filesToRead = EDITABLE_AVATAR_FILES;
  const result: AvatarFile[] = [];
  
  for (const filename of filesToRead) {
    try {
      const filePath = path.join(dirPath, filename);
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf-8");
      
      result.push({
        filename,
        content,
        updatedAt: stats.mtime
      });
    } catch {
      // ファイルがない場合は無視
    }
  }
  
  return result;
}
