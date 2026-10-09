// ================================================
// note 記事テンプレートと全自動の記事作成
// ================================================
// テンプレート = 記事の「型」。構成・タイトルの付け方・有料/価格・有料ラインの位置・タグ・画像の入れ方・入稿のしかたを決めておく。
// ・記事エディタでは「テンプレートを適用」で価格・タグ・有料などを入れ、AI 執筆に構成の指示を渡す
// ・全自動（runFullArticle）は テーマ → 執筆 → 見出しごとの画像・図解 → 見出し画像 → note へ入稿（下書き / 公開 / 予約）を 1 回で行う
//   画面からは記事ジョブ（kind: "full"）、自動化ルール（actionType: "note_article"）からも同じ処理を呼ぶ
// テンプレートは AppSetting（article_templates）に JSON で保存する。

import { randomUUID } from "node:crypto";
import { prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { MARKER_RE } from "../markdown";
import { NOTE_PRICE_MAX, NOTE_PRICE_MIN } from "../platforms/note";
import { generateEyecatch, generateNoteDraft, insertVisualMarkers, planVisuals, renderVisualMarkers } from "./article";
import type { MediaRef } from "./media";
import { createPosts } from "./publish";
import { getSetting, setSetting } from "./store";

const KEY = "article_templates";

export type ArticlePublishMode = "draft" | "publish";

export interface ArticleTemplate {
  id: string;
  name: string;
  /** 構成・書き方の指示（例: 導入 → 悩みの共感 → 3 つの手順 → まとめ） */
  structure: string;
  /** タイトルの付け方（任意） */
  titleHint: string;
  paid: boolean;
  /** 有料記事の価格（円）。無料なら null */
  price: number | null;
  /** 有料ラインをどこに入れるか（任意。例: 3 つの手順の 2 つ目から有料） */
  paywallHint: string;
  tags: string[];
  /** 見出しごとの画像・図解を AI に決めさせて作るか */
  visuals: boolean;
  /** 画像・図解の上限（1〜8） */
  maxVisuals: number;
  /** 見出し画像（1280×670）を AI で作るか */
  eyecatch: boolean;
  /** 入稿のしかた: 下書きに保存 / 公開まで */
  publish: ArticlePublishMode;
  updatedAt: string;
}

export type ArticleTemplateInput = Partial<Omit<ArticleTemplate, "id" | "updatedAt">> & { id?: string };

/** 入力を検証して保存できる形にする */
export function normalizeTemplate(input: ArticleTemplateInput, now = new Date()): ArticleTemplate {
  const name = String(input.name ?? "").trim();
  if (!name) throw new ConfigError("テンプレート名を入力してください");
  const paid = !!input.paid;
  let price: number | null = null;
  if (paid) {
    price = Number(String(input.price ?? "").replace(/[,，¥円\s]/g, ""));
    if (!Number.isInteger(price) || price < NOTE_PRICE_MIN || price > NOTE_PRICE_MAX) throw new ConfigError(`有料記事の価格は ${NOTE_PRICE_MIN}〜${NOTE_PRICE_MAX.toLocaleString()} 円の整数で入力してください`);
  }
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : String(input.tags ?? "").split(/[,、\s]+/)).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean))].slice(0, 10);
  const maxVisuals = Math.min(8, Math.max(1, Math.round(Number(input.maxVisuals ?? 4)) || 4));
  return {
    id: input.id || randomUUID(),
    name: name.slice(0, 60),
    structure: String(input.structure ?? "").trim().slice(0, 2000),
    titleHint: String(input.titleHint ?? "").trim().slice(0, 300),
    paid,
    price,
    paywallHint: paid ? String(input.paywallHint ?? "").trim().slice(0, 300) : "",
    tags,
    visuals: input.visuals !== false,
    maxVisuals,
    eyecatch: input.eyecatch !== false,
    publish: input.publish === "publish" ? "publish" : "draft",
    updatedAt: now.toISOString(),
  };
}

export async function listArticleTemplates(): Promise<ArticleTemplate[]> {
  try {
    const rows = JSON.parse((await getSetting(KEY)) ?? "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function getArticleTemplate(id: string): Promise<ArticleTemplate> {
  const t = (await listArticleTemplates()).find((x) => x.id === id);
  if (!t) throw new ConfigError("記事テンプレートが見つかりません（削除された可能性があります）");
  return t;
}

export async function saveArticleTemplate(input: ArticleTemplateInput): Promise<ArticleTemplate> {
  const list = await listArticleTemplates();
  const t = normalizeTemplate(input);
  const i = list.findIndex((x) => x.id === t.id);
  if (i === -1) list.push(t);
  else list[i] = t;
  await setSetting(KEY, JSON.stringify(list));
  return t;
}

export async function deleteArticleTemplate(id: string): Promise<void> {
  const list = await listArticleTemplates();
  await setSetting(KEY, JSON.stringify(list.filter((x) => x.id !== id)));
}

/** テンプレートから AI 執筆への追加の指示を作る */
export function templatePrompt(t: Pick<ArticleTemplate, "structure" | "titleHint" | "paid" | "paywallHint">): string {
  return [
    t.structure && `記事の構成・書き方（この型に沿って書く）:\n${t.structure}`,
    t.titleHint && `タイトルの付け方: ${t.titleHint}`,
    t.paid && t.paywallHint && `有料ライン（<!-- paywall -->）の位置: ${t.paywallHint}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 作れなかった画像・図解の目印を取り除く（全自動では［画像：…］の文字を残さない） */
export function stripVisualMarkers(md: string): string {
  return md
    .split("\n")
    .filter((l) => {
      const m = MARKER_RE.exec(l);
      return !m || m[1] === "paywall";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export interface FullArticleInput {
  avatarId: string;
  /** note のアカウント（省略時はアバターの最初の note アカウント） */
  accountId?: string;
  templateId?: string;
  /** テンプレートを使わない・上書きするときの値 */
  template?: Partial<ArticleTemplate>;
  title?: string;
  topic?: string;
  /** 入稿のしかた（省略時はテンプレートの設定） */
  publish?: ArticlePublishMode;
  /** 予約（この時刻に入稿・公開する） */
  scheduledAt?: Date;
  /** 自動化ルールから実行したとき */
  ruleId?: string;
  onProgress?: (text: string) => unknown;
}

export interface FullArticleResult {
  contentId: string;
  title: string;
  topic: string;
  markdown: string;
  publish: ArticlePublishMode;
  scheduledAt: string | null;
  images: number;
  eyecatch: boolean;
  warnings: string[];
}

/** テーマ → 執筆 → 画像・図解 → 見出し画像 → note へ入稿 を 1 回で行う */
export async function runFullArticle(input: FullArticleInput): Promise<FullArticleResult> {
  const progress = async (t: string) => {
    await input.onProgress?.(t);
  };
  const base = input.templateId ? await getArticleTemplate(input.templateId) : undefined;
  const t = { ...normalizeTemplate({ name: "（テンプレートなし）", visuals: true, eyecatch: true }), ...(base ?? {}), ...(input.template ?? {}) };
  const account = await prisma.snsAccount.findFirst({
    where: { platform: "note", isActive: true, avatarId: input.avatarId, ...(input.accountId ? { id: input.accountId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!account) throw new ConfigError("このアバターに有効な note アカウントがありません（設定 > アカウント）");
  if (!input.title?.trim() && !input.topic?.trim()) throw new ConfigError("テーマかタイトルを入力してください");
  const warnings: string[] = [];

  await progress("執筆中");
  const draft = await generateNoteDraft({ avatarId: input.avatarId, title: input.title, topic: input.topic, paid: t.paid, extraPrompt: templatePrompt(t) || undefined });
  let md = draft.markdown;
  const media: MediaRef[] = [];

  if (t.visuals) {
    try {
      await progress("画像・図解の計画");
      const plan = await planVisuals({ markdown: md, maxVisuals: t.maxVisuals });
      if (plan.length) {
        md = insertVisualMarkers(md, plan);
        const r = await renderVisualMarkers({ avatarId: input.avatarId, markdown: md, onProgress: (done, total) => progress(`画像・図解 ${done} / ${total}`) });
        md = r.markdown;
        media.push(...r.media);
        for (const x of r.results) if ("error" in x && x.error) warnings.push(`${x.kind === "image" ? "画像" : "図解"}「${x.description}」を作れませんでした（${x.error.slice(0, 80)}）`);
      }
    } catch (e) {
      if (e instanceof ConfigError && /見出し/.test(e.message)) warnings.push("見出しが無いため画像・図解は入れていません");
      else warnings.push(`画像・図解を作れませんでした（${(e instanceof Error ? e.message : String(e)).slice(0, 80)}）`);
    }
    md = stripVisualMarkers(md);
  }

  let eyecatch: MediaRef | undefined;
  if (t.eyecatch) {
    try {
      await progress("見出し画像の生成");
      eyecatch = await generateEyecatch({ avatarId: input.avatarId, title: draft.title, summary: md.slice(0, 400) });
    } catch (e) {
      warnings.push(`見出し画像を作れませんでした（${(e instanceof Error ? e.message : String(e)).slice(0, 80)}）`);
    }
  }

  const hasPaywall = /^\s*<!--\s*paywall\s*-->\s*$/m.test(md);
  if (t.paid && !hasPaywall) warnings.push("本文に有料ラインが入らなかったため、無料記事として入稿します");
  const publish = input.publish ?? t.publish;

  await progress("note へ入稿");
  const [content] = await createPosts({
    accountIds: [account.id],
    text: md,
    title: draft.title,
    tags: t.tags,
    media: [...media, ...(eyecatch ? [eyecatch] : [])],
    options: { note: { title: draft.title, price: t.paid && hasPaywall && t.price ? String(t.price) : "", eyecatch: eyecatch?.name ?? "", mode: publish } },
    scheduledAt: input.scheduledAt,
    category: input.ruleId ? "automation" : "manual",
    extraMetadata: { article: { templateId: input.templateId ?? null, model: draft.model, warnings }, ...(input.ruleId ? { automationId: input.ruleId } : {}) },
  });
  return {
    contentId: content.id,
    title: draft.title,
    topic: draft.topic,
    markdown: md,
    publish,
    scheduledAt: input.scheduledAt?.toISOString() ?? null,
    images: media.length,
    eyecatch: !!eyecatch,
    warnings,
  };
}
