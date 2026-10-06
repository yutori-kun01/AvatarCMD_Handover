// ================================================
// アバターごとの画像スタイル（参考画像 → スタイル定義）
// ================================================
// ・参考画像は複数枚登録できる（kind: image = イメージ画像の参考 / infographic = 図解の参考）。
// ・「スタイルを分析」で、画像を読めるモデル（用途: 画像スタイル分析）に参考画像を渡し、配色・タッチ・構図などの
//   スタイル定義（VisualStyle）を作って Avatar.imageStyle に保存する。定義は画面で直せる。
// ・イメージ画像の生成では、スタイル定義の言葉と参考画像（最大 4 枚）を一緒に渡す。
// ・v3.7: スタイル定義は「デザイン DNA」として 1 つにまとめ、イメージ画像と図解の両方で使う
//   （画像生成 AI の画像とテンプレートの図解がかけ離れないように）。参考画像の種類（image / infographic）は分析の材料の区別だけ。

import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { normalizeStyle, type VisualStyle } from "./infographic";
import { completeJson, type InputImage } from "./llm";
import { mediaPath, readMedia } from "./media";

export const STYLE_KINDS = ["image", "infographic"] as const;
export type StyleKind = (typeof STYLE_KINDS)[number];

function checkKind(kind: string): StyleKind {
  if (!STYLE_KINDS.includes(kind as StyleKind)) throw new ConfigError("種類は image（イメージ画像）か infographic（図解）です");
  return kind as StyleKind;
}

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export async function addStyleReference(input: { avatarId: string; kind: string; mediaName: string; note?: string | null }) {
  const kind = checkKind(input.kind);
  mediaPath(input.mediaName); // 名前の検証
  const ext = input.mediaName.split(".").pop() ?? "";
  if (!MIME[ext]) throw new ConfigError("参考画像は JPEG / PNG / WebP / GIF にしてください");
  if ((await prisma.styleReference.count({ where: { avatarId: input.avatarId, kind } })) >= 20) throw new ConfigError("参考画像は種類ごとに 20 枚までです");
  return prisma.styleReference.create({ data: { avatarId: input.avatarId, kind, mediaName: input.mediaName, note: input.note?.trim() || null } });
}

export async function listStyleReferences(avatarId: string) {
  const rows = await prisma.styleReference.findMany({ where: { avatarId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ ...r, url: `/media/${r.mediaName}` }));
}

export async function updateStyleReference(id: string, input: { note?: string | null; isActive?: boolean }) {
  return prisma.styleReference.update({
    where: { id },
    data: { ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}), ...(input.isActive !== undefined ? { isActive: !!input.isActive } : {}) },
  });
}

export async function removeStyleReference(id: string) {
  await prisma.styleReference.delete({ where: { id } });
}

/** 参考画像を AI に渡す形で読む（新しい順に max 枚。読めないファイルは飛ばす） */
export async function referenceImages(avatarId: string, kind: StyleKind, max = 4): Promise<InputImage[]> {
  const rows = await prisma.styleReference.findMany({ where: { avatarId, kind, isActive: true }, orderBy: { createdAt: "desc" }, take: max });
  const out: InputImage[] = [];
  for (const r of rows) {
    try {
      const bytes = await readMedia(r.mediaName);
      out.push({ mimeType: MIME[r.mediaName.split(".").pop() ?? ""] ?? "image/png", data: bytes.toString("base64") });
    } catch {
      // ファイルが消えている参考画像は使わない
    }
  }
  return out;
}

export type AvatarStyles = Record<StyleKind, VisualStyle>;

/** デザイン DNA（イメージ画像・図解で共通）。旧形式（image / infographic を別々に保存）も読む */
export async function getDesignDna(avatarId: string): Promise<VisualStyle> {
  const a = await prisma.avatar.findUnique({ where: { id: avatarId }, select: { imageStyle: true } });
  if (!a) throw new ConfigError("アバターが見つかりません");
  const raw = (a.imageStyle ?? {}) as Partial<Record<"dna" | StyleKind, Partial<VisualStyle>>>;
  return normalizeStyle(raw.dna ?? raw.image ?? raw.infographic);
}

/** 用途別の取り出し（どちらも同じデザイン DNA） */
export async function getAvatarStyles(avatarId: string): Promise<AvatarStyles> {
  const dna = await getDesignDna(avatarId);
  return { image: dna, infographic: dna };
}

/** デザイン DNA を保存する（kind は互換のため受け取るが、保存先は 1 つ） */
export async function saveAvatarStyle(avatarId: string, _kind: string | null, style: Partial<VisualStyle>) {
  const a = await prisma.avatar.findUniqueOrThrow({ where: { id: avatarId }, select: { imageStyle: true } });
  const saved = normalizeStyle(style);
  const next = { ...((a.imageStyle ?? {}) as Record<string, unknown>), dna: saved };
  await prisma.avatar.update({ where: { id: avatarId }, data: { imageStyle: next as object } });
  return saved;
}

const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dna", "palette", "background", "text", "muted", "corner", "iconStyle", "mood", "illustration", "composition", "avoid"],
  properties: {
    dna: {
      type: "string",
      description:
        "デザイン DNA: 画像生成 AI にそのまま渡すスタイルプロンプト（英語・60〜120 語）。画風・線・形の角丸・質感・光・色の使い方・構図・余白・アイコンの塗り/線を含め、" +
        "同じ作風のインフォグラフィック（フラットな図形・アイコン・グラフ）と並べても違和感がないように書く。画像の中の文字・人物・ブランドは含めない",
    },
    palette: { type: "array", items: { type: "string", description: "#rrggbb" }, description: "よく使われている色を 3〜6 色。目立つ色から順に" },
    background: { type: "string", description: "背景色 #rrggbb" },
    text: { type: "string", description: "文字色 #rrggbb" },
    muted: { type: "string", description: "補足の文字色 #rrggbb" },
    corner: { type: "number", description: "図形の角丸の強さ（0〜40 px 相当）" },
    iconStyle: { type: "string", enum: ["solid", "outline"] },
    mood: { type: "string", description: "雰囲気（日本語・60 文字まで）" },
    illustration: { type: "string", description: "画風・タッチ（例: フラットイラスト、水彩、写真、3D）（日本語・80 文字まで）" },
    composition: { type: "string", description: "構図・余白・人物の扱い（日本語・80 文字まで）" },
    avoid: { type: "array", items: { type: "string" }, description: "この作風で避けるべきこと（3〜5 個）" },
  },
};

/** 参考画像（イメージ画像用・図解用の両方）からデザイン DNA を作って保存する */
export async function analyzeStyle(avatarId: string, _kind?: string | null): Promise<VisualStyle> {
  const images = [...(await referenceImages(avatarId, "image", 4)), ...(await referenceImages(avatarId, "infographic", 3))];
  if (!images.length) throw new ConfigError("参考画像を登録してください");
  const notes = (await prisma.styleReference.findMany({ where: { avatarId, isActive: true, note: { not: null } }, select: { note: true } })).map((r) => r.note);
  const { data } = await completeJson<Partial<VisualStyle>>({
    task: "style",
    system:
      "あなたはアートディレクターです。渡された参考画像に共通する作風を読み取り、別の画像や図解を同じ作風で作るためのスタイル定義を作ります。" +
      "画像の中の文章・人物・ブランド名をそのまま写すのではなく、色・形・タッチ・構図の特徴だけを抽出してください。",
    user: [
      `参考画像 ${images.length} 枚の共通する作風を、記事のイメージ画像とインフォグラフィック図解（フラットな図形・アイコン・グラフ）の両方に使う 1 つのデザイン DNA にしてください。`,
      "図解はテンプレートで描くため、色（palette・background・text）・角丸（corner）・アイコンの塗り/線（iconStyle）は図解にそのまま使われます。イメージ画像がこの図解と並んでも同じシリーズに見えるよう、dna を書いてください。",
      notes.length ? `利用者のメモ: ${notes.join(" / ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    images,
    json: { name: "visual_style", schema: STYLE_SCHEMA },
  });
  const style = normalizeStyle(data);
  await saveAvatarStyle(avatarId, null, style);
  return style;
}
