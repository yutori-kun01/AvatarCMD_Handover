// ================================================
// note 記事の執筆 — 本文・見出しごとの画像／図解・見出し画像
// ================================================
// 流れ（記事エディタ）:
//   1. generateNoteDraft(): アバターの口調・ナレッジで Markdown 記事を書く（有料なら <!-- paywall --> の位置も提案）
//        タイトルだけ・タイトル＋テーマ・テーマだけ・書きかけの本文のどれからでも書け、入力済みの部分は活かす
//        （画面からはジョブとして依頼し、worker がバックグラウンドで実行する: article-jobs.ts）
//   2. planVisuals(): 大見出し・小見出しごとに「画像なし / イメージ画像 / 図解」を決め、目印を本文に入れる
//        <!-- image: 説明 -->  /  <!-- infographic: 説明 -->
//   3. renderVisualMarkers(): 目印を順に画像にして ![説明](media:{name}) に置き換える
//        イメージ画像 = 画像生成 AI（アバターのスタイル定義と参考画像を渡す。画像内に文字を入れない）
//        図解 = AI が設計図（JSON）を作り、テンプレートで描く（infographic.ts）
//   4. 投稿（createPosts）→ note の下書きに本文・画像・見出し画像・有料ライン・価格・タグが入る
// どの段階も人が編集・作り直しできる（目印や画像の行は Markdown のまま見える）。

import { ConfigError } from "../http";
import { MARKER_RE } from "../markdown";
import { buildPrompts, loadAvatarContext } from "./ai";
import { cleanPostText } from "../post-text";
import { fitImage, generateAndSaveImage, getImageSettings, IMAGE_TARGETS, type ImageAspect, type ImageTarget } from "./image-gen";
import { INFOGRAPHIC_TYPES, LIMITS, normalizeSpec, renderInfographic, type InfographicSpec, type VisualStyle } from "./infographic";
import { completeJson } from "./llm";
import { saveMedia, type MediaRef } from "./media";
import { getAvatarStyles, referenceImages } from "./style";
import { prisma } from "@avatar-cmd/db";

// --- 1. 本文 -----------------------------------------------------------------------

export interface NoteDraftInput {
  avatarId: string;
  /** 記事タイトル（空なら AI が付ける） */
  title?: string;
  /** テーマ（空ならタイトル・本文から読み取る） */
  topic?: string;
  /** 書きかけの本文（あれば活かして足りない部分を書く） */
  markdown?: string;
  paid?: boolean;
  /** true: 入力済みのタイトル・本文は一字も変えず、足りない部分だけ書く */
  preserve?: boolean;
  extraPrompt?: string;
}

export interface NoteDraft {
  title: string;
  topic: string;
  markdown: string;
  model: string;
  /** 入力済みとして扱った項目 */
  kept: ("title" | "topic" | "markdown")[];
}

/** 本文を一字も変えない場合: 前に足す部分・後に足す部分だけを書かせる */
const APPEND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "topic", "before", "after"],
  properties: {
    title: { type: "string", description: "記事タイトル（32 文字前後。# は付けない）" },
    topic: { type: "string", description: "記事のテーマ（1 文）" },
    before: { type: "string", description: "書きかけの本文の前に足す Markdown（導入など。不要なら空）" },
    after: { type: "string", description: "書きかけの本文の後に足す Markdown（続き・まとめなど。不要なら空）" },
  },
};

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "topic", "markdown"],
  properties: {
    title: { type: "string", description: "記事タイトル（32 文字前後。# は付けない）" },
    topic: { type: "string", description: "記事のテーマ（1 文）" },
    markdown: { type: "string", description: "本文の Markdown（タイトル行は含めない）" },
  },
};

/**
 * note の記事を書く。タイトルだけ・タイトルとテーマ・テーマだけ・書きかけの本文、どの組み合わせからでも書ける。
 * 入力済みの部分は内容を保ったまま磨き（preserve なら一字も変えず）、足りない部分を補う。
 */
export async function generateNoteDraft(input: NoteDraftInput): Promise<NoteDraft> {
  const title = input.title?.trim() ?? "";
  const topic = input.topic?.trim() ?? "";
  const body = input.markdown?.trim() ?? "";
  if (!title && !topic && !body) throw new ConfigError("タイトル・テーマ・本文のどれかを入力してください");
  const kept = [title && "title", topic && "topic", body && "markdown"].filter(Boolean) as NoteDraft["kept"];

  const query = [title, topic, body.slice(0, 300)].filter(Boolean).join(" ");
  const { avatar, persona, knowledge } = await loadAvatarContext(input.avatarId, { query, platform: "note" });
  const { system } = buildPrompts(avatar, persona, { topic: topic || title, platform: "note" }, knowledge);

  const keep = input.preserve
    ? "入力済みの項目は一字も変えずにそのまま返してください。"
    : "入力済みの項目は、書いた人の意図・主張・言い回しの良さを保ったまま、読みやすく最適化してください（別の内容に差し替えない）。";
  const user = [
    "note の記事を 1 本仕上げてください。次の入力のうち、空の項目はあなたが補います。",
    "",
    `## タイトル\n${title || "（未入力 → 内容に合う、読みたくなるタイトルを付ける。32 文字前後）"}`,
    `## テーマ\n${topic || "（未入力 → タイトルや本文から読み取って 1 文で書く）"}`,
    `## 本文\n${body ? `以下は書きかけの本文です。\n----\n${body}\n----` : "（未入力 → タイトルとテーマに沿って全文を書く）"}`,
    "",
    "# 指示",
    keep,
    title && "本文はタイトルが約束している内容に必ず応えてください。",
    body && (input.preserve
      ? "書きかけの本文は変えません。その前に足す部分（before: 導入など）と後に足す部分（after: 続き・まとめなど）だけを書いてください。本文と重複する内容は書かないでください。"
      : "書きかけの本文の構成と内容を土台にして、足りない見出し・段落を補い、全体を 1 本の記事として整えてください。"),
    "本文は Markdown。## を大見出し、### を小見出しに使う（# は使わない）。本文にタイトル行は入れない。",
    "1 段落は 2〜4 文。大事な一文は **太字** にしてください（1 見出しに 1〜2 か所まで）。",
    input.paid
      ? "有料記事です。読者が続きを読みたくなる導入と無料部分のあと、有料にする位置に <!-- paywall --> とだけ書いた行を 1 回入れてください（既にあれば位置を保つ）。"
      : "無料記事です。<!-- paywall --> は入れないでください。",
    "画像・図解の目印（<!-- image: --> など）は新しく入れないでください。書きかけの本文にある目印・画像の行（![...](media:...)）はそのまま残してください。",
    input.extraPrompt && `追加の指示: ${input.extraPrompt}`,
  ]
    .filter(Boolean)
    .join("\n");

  const append = !!(input.preserve && body);
  const { data, model } = await completeJson<{ title: string; topic: string; markdown?: string; before?: string; after?: string }>({
    task: "article",
    system,
    user,
    json: append ? { name: "note_article_append", schema: APPEND_SCHEMA } : { name: "note_article", schema: DRAFT_SCHEMA },
  });
  const clean = (t: unknown) => cleanPostText(String(t ?? ""), { article: true }).replace(/^\s*#\s+[^\n]*\n+/, "").trim();
  let md: string;
  if (append) {
    md = [clean(data.before), body, clean(data.after)].filter(Boolean).join("\n\n");
  } else {
    // 先頭にタイトル行（# …）が入っていたら外す
    md = clean(data.markdown);
    if (!md) throw new Error(`${model} から本文が返りませんでした`);
    // 書きかけの本文にあった画像は必ず残す（AI が落としたら末尾に戻す）
    const lost = [...body.matchAll(/!\[[^\]]*\]\(media:[^)\s]+\)/g)].map((m) => m[0]).filter((l) => !md.includes(l));
    if (lost.length) md = `${md}\n\n${lost.join("\n\n")}`;
  }
  return {
    title: (input.preserve && title) || String(data.title ?? "").replace(/^#+\s*/, "").trim() || title || topic,
    topic: (input.preserve && topic) || String(data.topic ?? "").trim() || topic,
    markdown: md,
    model,
    kept,
  };
}

/** 互換: テーマだけから本文を書く（以前の API） */
export async function generateNoteArticle(input: { avatarId: string; topic: string; paid?: boolean; extraPrompt?: string }) {
  const d = await generateNoteDraft({ avatarId: input.avatarId, topic: input.topic, paid: input.paid, extraPrompt: input.extraPrompt });
  return { text: `# ${d.title}\n\n${d.markdown}`, model: d.model, title: d.title, topic: d.topic, markdown: d.markdown };
}

// --- 2. 見出しごとの画像・図解の計画 ------------------------------------------------

export interface Section {
  /** 見出しの行番号（0 始まり） */
  line: number;
  level: 2 | 3;
  heading: string;
  /** 見出しの下の本文（次の見出しまで） */
  body: string;
}

/** Markdown を見出しごとに分ける（## と ###。# は ## と同じ扱い） */
export function splitSections(md: string): Section[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Section[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && /^\s*(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) out.push({ line: i, level: h[1].length <= 2 ? 2 : 3, heading: h[2], body: "" });
    else if (out.length) out[out.length - 1].body += `${l}\n`;
  });
  for (const s of out) s.body = s.body.trim();
  return out;
}

export interface VisualPlan {
  /** splitSections の順番 */
  section: number;
  kind: "image" | "infographic";
  /** 何を見せるか（日本語・40 文字まで。目印の説明になる） */
  description: string;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["visuals"],
  properties: {
    visuals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "kind", "description"],
        properties: {
          section: { type: "integer", description: "見出しの番号（0 始まり）" },
          kind: { type: "string", enum: ["image", "infographic"] },
          description: { type: "string", description: "何を見せるか（日本語・40 文字まで）" },
        },
      },
    },
  },
};

/** 見出しごとに、画像なし・イメージ画像・図解のどれにするかを AI に決めさせる */
export async function planVisuals(input: { markdown: string; maxVisuals?: number }): Promise<VisualPlan[]> {
  const sections = splitSections(input.markdown);
  if (!sections.length) throw new ConfigError("見出し（## / ###）がありません。見出しごとに画像・図解を入れるには見出しが必要です");
  const max = input.maxVisuals ?? Math.min(8, sections.length);
  const { data } = await completeJson<{ visuals: VisualPlan[] }>({
    task: "visual",
    system: [
      "あなたは note 記事の編集者です。記事の見出しごとに、読者の理解を助ける画像を入れるか決めます。",
      "infographic（図解）: 手順・比較・循環・階層・数値・チェックリストなど、構造や数字を図で見せると初心者がすぐ分かる見出しに使う。",
      "image（イメージ画像）: 雰囲気・場面・感情を伝えたい見出し（導入・体験談・まとめ）に使う。",
      "画像が無くても伝わる見出しには入れない。同じ種類が続きすぎないようにする。",
    ].join("\n"),
    user: [
      `最大 ${max} 個まで。見出しの一覧:`,
      ...sections.map((s, i) => `[${i}] ${"#".repeat(s.level)} ${s.heading}\n${s.body.slice(0, 400)}`),
    ].join("\n\n"),
    json: { name: "visual_plan", schema: PLAN_SCHEMA },
  });
  const seen = new Set<number>();
  return (data.visuals ?? [])
    .filter((v) => Number.isInteger(v.section) && v.section >= 0 && v.section < sections.length && !seen.has(v.section) && seen.add(v.section))
    .slice(0, max)
    .map((v) => ({ section: v.section, kind: v.kind === "infographic" ? "infographic" : "image", description: [...String(v.description ?? "").trim()].slice(0, 40).join("") || sections[v.section].heading }));
}

/** 計画どおり、各見出しの直後に目印を入れる（既に目印・画像がある見出しには入れない） */
export function insertVisualMarkers(md: string, plan: VisualPlan[]): string {
  const sections = splitSections(md);
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const at = new Map<number, string>();
  for (const p of plan) {
    const s = sections[p.section];
    if (!s) continue;
    if (/<!--\s*(image|infographic)\s*:|!\[[^\]]*\]\(/.test(s.body.split("\n").slice(0, 3).join("\n"))) continue;
    at.set(s.line, `<!-- ${p.kind}: ${p.description.replace(/-->/g, "")} -->`);
  }
  return lines.flatMap((l, i) => (at.has(i) ? [l, "", at.get(i)!] : [l])).join("\n");
}

// --- 3. 目印 → 画像 ------------------------------------------------------------------

const SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "chart", "left", "right", "items"],
  properties: {
    type: { type: "string", enum: [...INFOGRAPHIC_TYPES] },
    title: { type: "string", description: `図のタイトル（${LIMITS.title} 文字まで）` },
    chart: { type: "string", enum: ["bar", "pie", "line", "none"], description: "type が chart のときの種類。それ以外は none" },
    left: { type: "string", description: "compare の左の見出し（例: これまで）。それ以外は空" },
    right: { type: "string", description: "compare の右の見出し（例: これから）。それ以外は空" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["icon", "label", "note", "value", "unit", "side"],
        properties: {
          icon: { type: "string", description: "Font Awesome Free（solid）のアイコン名（例: rocket, chart-line, lightbulb, users, clock）。fa: を付けてもよい" },
          label: { type: "string", description: `ラベル（${LIMITS.label} 文字まで）` },
          note: { type: "string", description: `補足（${LIMITS.note} 文字まで。不要なら空）` },
          value: { type: ["number", "null"], description: "数値（stat / chart のとき。根拠のある数字だけ。無ければ null）" },
          unit: { type: "string", description: "単位（%・人・円など。無ければ空）" },
          side: { type: "string", enum: ["left", "right", "none"] },
        },
      },
    },
  },
};

/** 図解の設計図を AI に作らせる（文字数などの問題があれば 1 回だけ作り直させる） */
export async function designInfographic(input: { description: string; context: string }): Promise<{ spec: Partial<InfographicSpec>; issues: string[] }> {
  const system = [
    "あなたはインフォグラフィックのデザイナーです。初心者が文字をほとんど読まなくても理解できる図解を設計します。",
    `文字は最小限: タイトル ${LIMITS.title} 文字まで、ラベル ${LIMITS.label} 文字まで、補足 ${LIMITS.note} 文字まで（補足は本当に必要なときだけ）。`,
    `要素は ${LIMITS.minItems}〜${LIMITS.maxItems} 個（chart は ${LIMITS.maxChartItems} 個まで）。意味が伝わるアイコンを各要素に選ぶ。`,
    "型: steps=手順・流れ / compare=比較・前後 / cycle=繰り返すサイクル / hierarchy=1つの中心と複数の要素（items の先頭が中心）/ stat=大きな数字 / chart=棒・円・折れ線グラフ / checklist=チェック項目。",
    "数値は本文に根拠があるものだけ使う。数値の無い内容を stat / chart にしない。",
  ].join("\n");
  let user = `図にしたい内容: ${input.description}\n\n本文:\n${input.context.slice(0, 2000)}`;
  let last: { spec: Partial<InfographicSpec>; issues: string[] } = { spec: {}, issues: [] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await completeJson<any>({ task: "visual", system, user, json: { name: "infographic", schema: SPEC_SCHEMA } });
    const spec: Partial<InfographicSpec> = {
      type: data.type,
      title: data.title,
      chart: data.chart === "none" ? undefined : data.chart,
      left: data.left || undefined,
      right: data.right || undefined,
      items: (data.items ?? []).map((x: any) => ({ icon: x.icon, label: x.label, note: x.note || undefined, value: typeof x.value === "number" ? x.value : undefined, unit: x.unit || undefined, side: x.side === "none" ? undefined : x.side })),
    };
    const { issues } = normalizeSpec(spec);
    last = { spec, issues: issues.filter((i) => !i.startsWith("見つからないアイコン")) };
    if (!last.issues.length) break;
    user += `\n\n前回の設計の問題: ${last.issues.join(" / ")}。直して作り直してください。`;
  }
  return last;
}

/**
 * イメージ画像のプロンプト（画像内に文字を入れない・デザイン DNA を反映）。
 * 図解と同じ色・角丸・アイコンの塗り/線をプロンプトにも入れ、同じシリーズに見えるようにする。
 */
export function imagePrompt(description: string, context: string, style: VisualStyle, target: ImageTarget = "section"): string {
  const size = IMAGE_TARGETS[target];
  return [
    target === "eyecatch"
      ? `Create a cover image (thumbnail) for a Japanese blog article on note.com.`
      : `Create an editorial illustration for a section of a Japanese blog article (note.com).`,
    `What to depict: ${description}`,
    context && `Section summary (Japanese, for context only): ${context.slice(0, 400)}`,
    style.dna && `Design DNA (follow strictly): ${style.dna}`,
    `It must look like the same series as flat infographics drawn with: background ${style.background}, palette ${style.palette.join(", ")}, ${style.corner}px rounded corners, ${style.iconStyle === "outline" ? "outlined line icons" : "solid filled icons"}.`,
    `The final image is cropped to ${size.width}x${size.height} (${(size.width / size.height).toFixed(2)}:1). Keep the main subject centered with generous margins so nothing important is cut off.`,
    style.illustration && `Art style: ${style.illustration}`,
    style.mood && `Mood: ${style.mood}`,
    style.composition && `Composition: ${style.composition}`,
    `Color palette: ${style.palette.join(", ")} on ${style.background}.`,
    `Match the look of the attached reference images if any (style only; do not copy their content).`,
    `Do NOT include any text, letters, numbers, logos, watermarks or UI.`,
    style.avoid?.length && `Avoid: ${style.avoid.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface RenderedVisual {
  kind: "image" | "infographic";
  description: string;
  media: MediaRef;
  issues?: string[];
  error?: string;
}

/** 1 つの画像・図解を作って保存する */
export async function renderVisual(input: { avatarId: string; kind: "image" | "infographic"; description: string; context?: string; aspect?: ImageAspect; spec?: Partial<InfographicSpec> }): Promise<RenderedVisual> {
  const styles = await getAvatarStyles(input.avatarId);
  if (input.kind === "infographic") {
    const designed = input.spec ? { spec: input.spec, issues: [] as string[] } : await designInfographic({ description: input.description, context: input.context ?? "" });
    const r = renderInfographic(designed.spec, styles.infographic);
    // 図解もイメージ画像と同じサイズ（1280×720）・形式にそろえる
    const { format } = await getImageSettings();
    const out = format === "png" ? { bytes: r.png, mimeType: "image/png" } : await fitImage(r.png, null, format);
    const media = await saveMedia(out.bytes, `infographic.${format}`, out.mimeType);
    return { kind: "infographic", description: input.description, media: { ...media, alt: input.description }, issues: r.issues };
  }
  const refs = await referenceImages(input.avatarId, "image", 4);
  const media = await generateAndSaveImage({ prompt: imagePrompt(input.description, input.context ?? "", styles.image, "section"), references: refs, aspect: input.aspect ?? "16:9", target: "section", avatarId: input.avatarId, filename: "image" });
  return { kind: "image", description: input.description, media: { name: media.name, mimeType: media.mimeType, size: media.size, filename: media.filename, alt: input.description } };
}

/**
 * 本文中の目印を順に画像にして ![説明](media:{name}) に置き換える。
 * 失敗した目印はそのまま残し、理由を返す（作り直しや手動の差し替えができるように）。
 */
export async function renderVisualMarkers(input: {
  avatarId: string;
  markdown: string;
  only?: number[];
  /** 1 つ作り終えるごと（バックグラウンドの進み具合の表示用） */
  onProgress?: (done: number, total: number) => unknown;
}): Promise<{
  markdown: string;
  media: MediaRef[];
  results: (RenderedVisual | { kind: string; description: string; error: string })[];
  /** 目印の行 → 画像の行（生成中に本文が編集されていても、目印の行だけを置き換えられるように） */
  replacements: { marker: string; replacement: string }[];
}> {
  const lines = input.markdown.replace(/\r\n?/g, "\n").split("\n");
  const sections = splitSections(input.markdown);
  const results: (RenderedVisual | { kind: string; description: string; error: string })[] = [];
  const media: MediaRef[] = [];
  const replacements: { marker: string; replacement: string }[] = [];
  const targets: number[] = [];
  let n = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = MARKER_RE.exec(lines[i]);
    if (!m || m[1] === "paywall") continue;
    n++;
    if (!input.only || input.only.includes(n)) targets.push(i);
  }
  for (const [done, i] of targets.entries()) {
    await input.onProgress?.(done, targets.length);
    const m = MARKER_RE.exec(lines[i])!;
    const kind = m[1] as "image" | "infographic";
    const description = (m[2] ?? "").trim() || "記事の内容";
    const section = [...sections].reverse().find((s) => s.line < i);
    try {
      const r = await renderVisual({ avatarId: input.avatarId, kind, description, context: section ? `${section.heading}\n${section.body.replace(MARKER_RE, "")}` : "" });
      const replacement = `![${description.replace(/[\[\]]/g, "")}](media:${r.media.name})`;
      replacements.push({ marker: lines[i], replacement });
      lines[i] = replacement;
      media.push(r.media);
      results.push(r);
    } catch (e) {
      results.push({ kind, description, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await input.onProgress?.(targets.length, targets.length);
  return { markdown: lines.join("\n"), media, results, replacements };
}

/** 見出し画像（記事タイトルから。note の見出し画像は横長） */
export async function generateEyecatch(input: { avatarId: string; title: string; summary?: string }): Promise<MediaRef> {
  const styles = await getAvatarStyles(input.avatarId);
  const refs = await referenceImages(input.avatarId, "image", 4);
  const m = await generateAndSaveImage({
    prompt: imagePrompt(`記事の見出し画像（アイキャッチ）。記事タイトル: ${input.title}`, input.summary ?? "", styles.image, "eyecatch"),
    references: refs,
    aspect: "16:9",
    target: "eyecatch",
    avatarId: input.avatarId,
    filename: "eyecatch",
  });
  return { name: m.name, mimeType: m.mimeType, size: m.size, filename: m.filename, alt: "eyecatch" };
}

/** 本文から参照している media:{name} の一覧（投稿に添付するファイル） */
export function referencedMedia(md: string): string[] {
  return [...new Set([...md.matchAll(/!\[[^\]]*\]\(media:([a-f0-9-]{36}\.(?:png|jpg|webp|gif))\)/g)].map((m) => m[1]))];
}

/** 記事に使えるアカウント（note） */
export async function noteAccounts(avatarId?: string) {
  return prisma.snsAccount.findMany({ where: { platform: "note", isActive: true, ...(avatarId ? { avatarId } : {}) }, select: { id: true, avatarId: true, accountName: true } });
}
