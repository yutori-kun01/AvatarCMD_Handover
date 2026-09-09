import fs from "fs/promises";
import path from "path";

const AVATARS_DIR = path.join(process.cwd(), "data", "avatars");
const TEMPLATE_DIR = path.join(AVATARS_DIR, "_template");

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
      const soulTemplate = await fs.readFile(path.join(TEMPLATE_DIR, "soul.md"), "utf-8");
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
  await ensureAvatarDirectory(avatarId);
  const filePath = path.join(getAvatarDirPath(avatarId), filename);
  
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
  await ensureAvatarDirectory(avatarId);
  const filePath = path.join(getAvatarDirPath(avatarId), filename);
  
  // ディレクトリトラバーサル防止の簡易チェック
  if (filename.includes("..") || filename.includes("/")) {
    throw new Error("Invalid filename");
  }
  
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * アバターの主要ファイル一覧を取得する
 */
export async function listAvatarFiles(avatarId: string): Promise<AvatarFile[]> {
  await ensureAvatarDirectory(avatarId);
  const dirPath = getAvatarDirPath(avatarId);
  
  const filesToRead = ["soul.md", "identity.md", "rules.md"];
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
