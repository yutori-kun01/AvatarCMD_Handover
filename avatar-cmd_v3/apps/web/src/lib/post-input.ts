export const PLATFORMS = [
  "x",
  "threads",
  "note",
  "instagram",
  "youtube",
  "tiktok",
  "zenn",
  "bluesky",
  "linkedin",
  "reddit",
  "medium",
  "substack",
  "facebook",
  "wordpress",
  "ameba",
  "standfm",
];
export function platformOf(value: unknown): string {
  const platform = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new Error("SNSを選択してください");
  return platform;
}
