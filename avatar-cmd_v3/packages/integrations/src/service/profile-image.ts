// ================================================
// プロフィール画像 → アバターのアイコン
// ================================================
// ・フォロワー数の取得（fetchProfile）と同じ呼び出しで画像 URL も受け取り、MEDIA_DIR に保存する。
//   Threads などの CDN の URL は期限付きのため、外部 URL をそのまま表示しない。
// ・アバターのアイコンは「手動設定 > X > Threads > Bluesky > YouTube > その他」の順で選ぶ。
//   手動で設定したアイコン（avatarImageSource = manual）は自動取得で上書きしない。

import { createHash } from "crypto";
import { unlink } from "fs/promises";
import { prisma } from "@avatar-cmd/db";
import { mediaPath, saveMedia } from "./media";

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** アイコンに使う順番（左ほど優先） */
export const ICON_PRIORITY = ["x", "threads", "bluesky", "youtube", "instagram", "facebook", "linkedin", "tiktok"];

export function iconRank(platform: string): number {
  const i = ICON_PRIORITY.indexOf(platform);
  return i === -1 ? ICON_PRIORITY.length : i;
}

/** "/media/{name}" から name を取り出す（自分で保存したファイルだけ） */
function ownMediaName(url: string | null | undefined): string | null {
  const m = /^\/media\/([a-f0-9-]{36}\.(?:jpg|png|gif|webp))$/.exec(url ?? "");
  return m ? m[1] : null;
}

async function download(url: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!/^https:\/\//.test(url)) throw new Error("プロフィール画像の URL が https ではありません");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
  if (!res.ok) throw new Error(`プロフィール画像を取得できませんでした（HTTP ${res.status}）`);
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(mimeType)) throw new Error(`プロフィール画像の形式に対応していません: ${mimeType || "不明"}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("プロフィール画像が大きすぎます");
  return { bytes, mimeType };
}

/**
 * アカウントのプロフィール画像を保存する。前回と同じ画像なら何もしない。
 * 保存・変更したら、そのアバターのアイコンも選び直す。戻り値は保存した URL（変化なしは null）。
 */
export async function saveProfileImage(accountId: string, imageUrl: string, fetchImpl?: typeof fetch): Promise<string | null> {
  const acc = await prisma.snsAccount.findUniqueOrThrow({ where: { id: accountId } });
  const { bytes, mimeType } = await download(imageUrl, fetchImpl);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash === acc.profileImageHash && acc.profileImageUrl) return null;
  const ref = await saveMedia(bytes, `profile-${acc.platform}`, mimeType);
  const url = `/media/${ref.name}`;
  await prisma.snsAccount.update({ where: { id: acc.id }, data: { profileImageUrl: url, profileImageHash: hash } });
  await selectAvatarIcon(acc.avatarId);
  // 古い画像は、選び直しの後もどのアバターのアイコンにも使われていなければ消す（手動で同じ画像を選んでいる場合は残す）
  const old = ownMediaName(acc.profileImageUrl);
  if (old && !(await prisma.avatar.count({ where: { avatarImageUrl: acc.profileImageUrl } }))) await unlink(mediaPath(old)).catch(() => undefined);
  return url;
}

/** アバターのアイコンを接続アカウントの画像から選び直す（手動設定なら何もしない） */
export async function selectAvatarIcon(avatarId: string): Promise<string | null> {
  const avatar = await prisma.avatar.findUnique({ where: { id: avatarId }, select: { avatarImageUrl: true, avatarImageSource: true } });
  if (!avatar || avatar.avatarImageSource === "manual") return avatar?.avatarImageUrl ?? null;
  const accounts = await prisma.snsAccount.findMany({
    where: { avatarId, profileImageUrl: { not: null } },
    select: { id: true, platform: true, profileImageUrl: true, isActive: true, createdAt: true },
  });
  const best = accounts.sort((a, b) => Number(b.isActive) - Number(a.isActive) || iconRank(a.platform) - iconRank(b.platform) || a.createdAt.getTime() - b.createdAt.getTime())[0];
  const url = best?.profileImageUrl ?? null;
  const source = best ? `account:${best.id}` : null;
  if (url !== avatar.avatarImageUrl || source !== avatar.avatarImageSource) {
    await prisma.avatar.update({ where: { id: avatarId }, data: { avatarImageUrl: url, avatarImageSource: source } });
  }
  return url;
}

/** 手動でアイコンを設定する（null で自動選択に戻す） */
export async function setAvatarIcon(avatarId: string, mediaName: string | null): Promise<string | null> {
  if (!mediaName) {
    await prisma.avatar.update({ where: { id: avatarId }, data: { avatarImageSource: null } });
    return selectAvatarIcon(avatarId);
  }
  mediaPath(mediaName); // 名前の検証
  const url = `/media/${mediaName}`;
  await prisma.avatar.update({ where: { id: avatarId }, data: { avatarImageUrl: url, avatarImageSource: "manual" } });
  return url;
}
