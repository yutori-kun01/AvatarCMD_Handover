// ================================================
// インフォグラフィック図解 — 設計図（JSON）からテンプレートで描く
// ================================================
// 画像生成 AI は日本語の文字や数値が崩れやすいため、図解は AI に「型・アイコン名・短いラベル・数値」だけを
// 設計させ、ここで SVG に描いて PNG に書き出す。文字は少なく、アイコン・図形・グラフで伝える。
// ・型: steps（手順）/ compare（比較）/ cycle（循環）/ hierarchy（階層）/ stat（大きな数字）/ chart（棒・円・折れ線）/ checklist
// ・色・角丸はアバターのスタイル定義（VisualStyle）から
// ・PNG 化は @resvg/resvg-js（ブラウザ不要）。日本語フォントはシステムのもの（Docker では fonts-noto-cjk を入れる）

import { Resvg } from "@resvg/resvg-js";
import { findRegular, resolveIcon, type IconSvg } from "./icons";

export const INFOGRAPHIC_TYPES = ["steps", "compare", "cycle", "hierarchy", "stat", "chart", "checklist"] as const;
export type InfographicType = (typeof INFOGRAPHIC_TYPES)[number];

export interface InfographicItem {
  /** アイコン名（fa:rocket / bi:lightning / lucide:rocket など） */
  icon: string;
  /** 短いラベル（12 文字まで） */
  label: string;
  /** 補足（24 文字まで。無くてよい） */
  note?: string;
  /** 数値（stat / chart） */
  value?: number;
  /** stat の単位（%・人・円 など） */
  unit?: string;
  /** compare: 左右どちらか */
  side?: "left" | "right";
}

export interface InfographicSpec {
  type: InfographicType;
  /** 図のタイトル（20 文字まで） */
  title: string;
  items: InfographicItem[];
  /** chart の種類 */
  chart?: "bar" | "pie" | "line";
  /** compare の左右の見出し */
  left?: string;
  right?: string;
}

/** 図解・イメージ画像のスタイル定義（参考画像から作り、画面で修正できる） */
export interface VisualStyle {
  /** 主に使う色（先頭ほど優先）。#rrggbb */
  palette: string[];
  background: string;
  text: string;
  muted: string;
  /** 角丸（px） */
  corner: number;
  /** solid: 塗りのアイコン / outline: 線のアイコン */
  iconStyle: "solid" | "outline";
  /** イメージ画像向けの言葉（雰囲気・画風・避けること） */
  mood?: string;
  illustration?: string;
  composition?: string;
  avoid?: string[];
}

export const DEFAULT_STYLE: VisualStyle = {
  palette: ["#4f7cff", "#8b5cf6", "#22c38e", "#f49d25", "#18c5dc", "#df3a3a"],
  background: "#ffffff",
  text: "#1f2937",
  muted: "#6b7280",
  corner: 20,
  iconStyle: "solid",
};

const HEX = /^#[0-9a-f]{6}$/i;
export function normalizeStyle(raw: Partial<VisualStyle> | null | undefined): VisualStyle {
  const s = raw ?? {};
  const palette = (Array.isArray(s.palette) ? s.palette : []).filter((c) => HEX.test(String(c))).slice(0, 8);
  return {
    palette: palette.length >= 2 ? palette : DEFAULT_STYLE.palette,
    background: HEX.test(String(s.background)) ? s.background! : DEFAULT_STYLE.background,
    text: HEX.test(String(s.text)) ? s.text! : DEFAULT_STYLE.text,
    muted: HEX.test(String(s.muted)) ? s.muted! : DEFAULT_STYLE.muted,
    corner: typeof s.corner === "number" && s.corner >= 0 && s.corner <= 48 ? s.corner : DEFAULT_STYLE.corner,
    iconStyle: s.iconStyle === "outline" ? "outline" : "solid",
    mood: typeof s.mood === "string" ? s.mood.slice(0, 200) : undefined,
    illustration: typeof s.illustration === "string" ? s.illustration.slice(0, 200) : undefined,
    composition: typeof s.composition === "string" ? s.composition.slice(0, 200) : undefined,
    avoid: Array.isArray(s.avoid) ? s.avoid.map(String).slice(0, 10) : undefined,
  };
}

// --- 設計図の検証 -------------------------------------------------------------------

export const LIMITS = { title: 20, label: 12, note: 24, side: 10, minItems: 2, maxItems: 6, maxChartItems: 8, maxTotalChars: 160 };

/** 文字数（全角・半角とも 1） */
const len = (s: string) => [...s].length;
const cut = (s: string, n: number) => (len(s) > n ? [...s].slice(0, n - 1).join("") + "…" : s);

/**
 * 設計図を検証して整える。問題（文字数オーバー・要素数）は issues に入れ、描ける形に直して返す。
 * issues が空でなければ、AI に作り直させる材料にする。
 */
export function normalizeSpec(raw: Partial<InfographicSpec>): { spec: InfographicSpec; issues: string[] } {
  const issues: string[] = [];
  const type = INFOGRAPHIC_TYPES.includes(raw.type as InfographicType) ? (raw.type as InfographicType) : "steps";
  if (raw.type && type !== raw.type) issues.push(`型「${raw.type}」は使えません（${INFOGRAPHIC_TYPES.join(" / ")}）`);
  const title = String(raw.title ?? "").trim();
  if (len(title) > LIMITS.title) issues.push(`タイトルが ${len(title)} 文字です（${LIMITS.title} 文字まで）`);
  const max = type === "chart" ? LIMITS.maxChartItems : LIMITS.maxItems;
  let items = (Array.isArray(raw.items) ? raw.items : []).filter((x) => x && String(x.label ?? "").trim());
  if (items.length < LIMITS.minItems) issues.push(`要素が ${items.length} 個です（${LIMITS.minItems} 個以上）`);
  if (items.length > max) {
    issues.push(`要素が ${items.length} 個です（${max} 個まで）`);
    items = items.slice(0, max);
  }
  const out: InfographicItem[] = items.map((x, i) => {
    const label = String(x.label).trim();
    const note = x.note ? String(x.note).trim() : undefined;
    if (len(label) > LIMITS.label) issues.push(`${i + 1} 個目のラベルが ${len(label)} 文字です（${LIMITS.label} 文字まで）`);
    if (note && len(note) > LIMITS.note) issues.push(`${i + 1} 個目の補足が ${len(note)} 文字です（${LIMITS.note} 文字まで）`);
    const value = typeof x.value === "number" && Number.isFinite(x.value) ? x.value : undefined;
    if ((type === "chart" || type === "stat") && value === undefined) issues.push(`${i + 1} 個目に数値がありません`);
    return {
      icon: String(x.icon ?? ""),
      label: cut(label, LIMITS.label),
      note: note ? cut(note, LIMITS.note) : undefined,
      value,
      unit: x.unit ? cut(String(x.unit), 4) : undefined,
      side: x.side === "right" ? "right" : x.side === "left" ? "left" : undefined,
    };
  });
  if (type === "compare") {
    // 左右の指定が無ければ前半を左、後半を右にする
    const half = Math.ceil(out.length / 2);
    out.forEach((x, i) => (x.side = x.side ?? (i < half ? "left" : "right")));
  }
  const total = len(title) + out.reduce((s, x) => s + len(x.label) + len(x.note ?? ""), 0);
  if (total > LIMITS.maxTotalChars) issues.push(`文字が多すぎます（合計 ${total} 文字。${LIMITS.maxTotalChars} 文字まで）`);
  const missing = out.filter((x) => !resolveIconStrict(x.icon)).map((x) => x.icon || "（空）");
  if (missing.length) issues.push(`見つからないアイコン: ${missing.join(", ")}（近いアイコンに置き換えました）`);
  return {
    spec: {
      type,
      title: cut(title, LIMITS.title),
      items: out,
      chart: raw.chart === "pie" || raw.chart === "line" ? raw.chart : type === "chart" ? "bar" : undefined,
      left: raw.left ? cut(String(raw.left), LIMITS.side) : undefined,
      right: raw.right ? cut(String(raw.right), LIMITS.side) : undefined,
    },
    issues,
  };
}

function resolveIconStrict(name: string): boolean {
  const r = resolveIcon(name);
  const want = name.toLowerCase().replace(/^(fa[srb]?|bi|lucide):/, "").replace(/^(fa|bi)-/, "");
  return !!name && r.name.endsWith(`:${want}`);
}

// --- 描画 -----------------------------------------------------------------------------

export const SIZE = { w: 1280, h: 720 };
const FONT = "'Noto Sans CJK JP','Noto Sans JP','Hiragino Sans','Yu Gothic','WenQuanYi Zen Hei',sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 文字幅の概算（全角 1em・半角 0.58em） */
const charW = (c: string) => (/[　-鿿＀-￯]/.test(c) ? 1 : 0.58);
export function textWidth(s: string, size: number): number {
  return [...s].reduce((w, c) => w + charW(c), 0) * size;
}
/** 指定幅で折り返す（行数を超えたら末尾を…） */
export function wrap(s: string, size: number, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const c of [...s]) {
    if (cur && textWidth(cur + c, size) > width) {
      lines.push(cur);
      cur = "";
    }
    cur += c;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = [...kept[maxLines - 1]].slice(0, -1).join("") + "…";
    return kept;
  }
  return lines;
}

function text(lines: string[], x: number, y: number, size: number, color: string, opts: { weight?: number; anchor?: "start" | "middle" | "end"; lineHeight?: number } = {}): string {
  const lh = opts.lineHeight ?? 1.3;
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${y + i * size * lh}" font-family="${FONT}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${color}" text-anchor="${opts.anchor ?? "middle"}">${esc(l)}</text>`
    )
    .join("");
}

function icon(ic: IconSvg, cx: number, cy: number, size: number, color: string): string {
  const paint = ic.stroke ? `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` : `fill="${color}"`;
  // bootstrap / lucide の中身は currentColor を使うので color も指定する
  return `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" viewBox="${ic.viewBox}" color="${color}" ${paint}>${ic.body.replace(/currentColor/g, color)}</svg>`;
}

/** 色を白に寄せる（背景のカード用） */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function iconFor(item: InfographicItem, style: VisualStyle): IconSvg {
  // 線のスタイルなら、同じ名前の Font Awesome Regular（線のアイコン）があればそちらを使う
  // （別のセットの同名アイコンは意味が違うことがあるため、セットをまたいで置き換えない）
  if (style.iconStyle === "outline" && !/^[a-z]+:/.test(item.icon)) {
    const regular = findRegular(item.icon);
    if (regular) return regular;
  }
  return resolveIcon(item.icon);
}

/** タイトルの下の領域（上端・下端） */
const AREA = { top: 140, bottom: 690 };
/** 高さ h のブロックを領域の縦中央に置いたときの上端 */
const centerTop = (h: number) => Math.round(AREA.top + Math.max(0, (AREA.bottom - AREA.top - h) / 2));

const fmt = (v: number | undefined) => (v === undefined ? "" : Math.abs(v) >= 10000 ? `${Math.round(v / 1000) / 10}万` : v.toLocaleString("ja-JP"));

function layoutSteps(spec: InfographicSpec, st: VisualStyle, numbered: boolean): string {
  const n = spec.items.length;
  const margin = 56;
  const gap = n > 4 ? 28 : 44;
  const cw = (SIZE.w - margin * 2 - gap * (n - 1)) / n;
  const hasNote = spec.items.some((x) => x.note);
  const ch = hasNote ? 360 : 300;
  const top = centerTop(ch);
  let out = "";
  spec.items.forEach((it, i) => {
    const x = margin + i * (cw + gap);
    const c = st.palette[i % st.palette.length];
    const cx = x + cw / 2;
    out += `<rect x="${x}" y="${top}" width="${cw}" height="${ch}" rx="${st.corner}" fill="${tint(c, 0.9)}"/>`;
    out += `<circle cx="${cx}" cy="${top + 100}" r="58" fill="${c}"/>` + icon(iconFor(it, st), cx, top + 100, 58, "#ffffff");
    if (numbered) out += `<circle cx="${x + 34}" cy="${top + 34}" r="20" fill="#ffffff" stroke="${c}" stroke-width="3"/>` + text([String(i + 1)], x + 34, top + 42, 22, c, { weight: 700 });
    const labelSize = cw < 200 ? 24 : 28;
    out += text(wrap(it.label, labelSize, cw - 32, 2), cx, top + 210, labelSize, st.text, { weight: 700 });
    if (it.note) out += text(wrap(it.note, 19, cw - 36, 3), cx, top + 290, 19, st.muted);
    if (numbered && i < n - 1) {
      const ax = x + cw + gap / 2;
      out += `<path d="M${ax - 8} ${top + ch / 2 - 14} L${ax + 8} ${top + ch / 2} L${ax - 8} ${top + ch / 2 + 14}" fill="none" stroke="${st.muted}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  });
  return out;
}

function layoutChecklist(spec: InfographicSpec, st: VisualStyle): string {
  const cols = spec.items.length > 3 ? 2 : 1;
  const rows = Math.ceil(spec.items.length / cols);
  const margin = 80;
  const gap = 24;
  const cw = (SIZE.w - margin * 2 - gap * (cols - 1)) / cols;
  const rh = Math.min(140, (AREA.bottom - AREA.top - gap * (rows - 1)) / rows);
  const top = centerTop(rows * rh + gap * (rows - 1));
  const check = resolveIcon("fa:circle-check");
  let out = "";
  spec.items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cw + gap);
    const y = top + row * (rh + gap);
    const c = st.palette[i % st.palette.length];
    out += `<rect x="${x}" y="${y}" width="${cw}" height="${rh}" rx="${st.corner}" fill="${tint(c, 0.9)}"/>`;
    out += icon(check, x + 44, y + rh / 2, 34, st.palette[2 % st.palette.length]);
    out += `<circle cx="${x + 112}" cy="${y + rh / 2}" r="32" fill="${c}"/>` + icon(iconFor(it, st), x + 112, y + rh / 2, 34, "#ffffff");
    const tx = x + 164;
    const tw = cw - 184;
    if (it.note) {
      out += text(wrap(it.label, 26, tw, 1), tx, y + rh / 2 - 6, 26, st.text, { weight: 700, anchor: "start" });
      out += text(wrap(it.note, 18, tw, 1), tx, y + rh / 2 + 26, 18, st.muted, { anchor: "start" });
    } else out += text(wrap(it.label, 28, tw, 2), tx, y + rh / 2 + 10, 28, st.text, { weight: 700, anchor: "start" });
  });
  return out;
}

function layoutStat(spec: InfographicSpec, st: VisualStyle): string {
  const n = spec.items.length;
  const cols = n <= 4 ? n : 3;
  const rows = Math.ceil(n / cols);
  const margin = 60;
  const gap = 28;
  const cw = (SIZE.w - margin * 2 - gap * (cols - 1)) / cols;
  const ch = rows > 1 ? (AREA.bottom - AREA.top - 20 - gap * (rows - 1)) / rows : 380;
  const top = centerTop(rows * ch + gap * (rows - 1));
  let out = "";
  spec.items.forEach((it, i) => {
    const x = margin + (i % cols) * (cw + gap);
    const y = top + Math.floor(i / cols) * (ch + gap);
    const c = st.palette[i % st.palette.length];
    const cx = x + cw / 2;
    const big = rows > 1 ? 56 : 76;
    out += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="${st.corner}" fill="${tint(c, 0.9)}"/>`;
    out += icon(iconFor(it, st), cx, y + ch * 0.2, rows > 1 ? 40 : 56, c);
    const v = fmt(it.value);
    const vw = textWidth(v, big) + (it.unit ? textWidth(it.unit, big * 0.42) + 6 : 0);
    out += `<text x="${cx - vw / 2}" y="${y + ch * 0.52}" font-family="${FONT}" font-size="${big}" font-weight="800" fill="${c}">${esc(v)}${it.unit ? `<tspan font-size="${Math.round(big * 0.42)}" dx="6">${esc(it.unit)}</tspan>` : ""}</text>`;
    out += text(wrap(it.label, 24, cw - 32, 1), cx, y + ch * 0.72, 24, st.text, { weight: 700 });
    if (it.note && rows === 1) out += text(wrap(it.note, 18, cw - 36, 2), cx, y + ch * 0.85, 18, st.muted);
  });
  return out;
}

function layoutCompare(spec: InfographicSpec, st: VisualStyle): string {
  const sides = (["left", "right"] as const).map((s) => spec.items.filter((x) => x.side === s));
  const margin = 60;
  const mid = 90;
  const pw = (SIZE.w - margin * 2 - mid) / 2;
  const rows = Math.max(1, ...sides.map((x) => x.length));
  const rh = Math.min(110, (AREA.bottom - AREA.top - 120) / rows);
  const ph = 84 + rows * rh + 24;
  const top = centerTop(ph);
  const colors = [st.muted, st.palette[0]];
  let out = "";
  sides.forEach((items, s) => {
    const x = margin + s * (pw + mid);
    const c = colors[s];
    out += `<rect x="${x}" y="${top}" width="${pw}" height="${ph}" rx="${st.corner}" fill="${tint(c, 0.9)}"/>`;
    out += `<rect x="${x}" y="${top}" width="${pw}" height="64" rx="${st.corner}" fill="${c}"/><rect x="${x}" y="${top + 40}" width="${pw}" height="24" fill="${c}"/>`;
    out += text([(s ? spec.right : spec.left) ?? (s ? "After" : "Before")], x + pw / 2, top + 43, 28, "#ffffff", { weight: 700 });
    items.forEach((it, i) => {
      const y = top + 84 + i * rh;
      out += `<circle cx="${x + 56}" cy="${y + rh / 2}" r="28" fill="${c}"/>` + icon(iconFor(it, st), x + 56, y + rh / 2, 28, "#ffffff");
      if (it.note) {
        out += text(wrap(it.label, 24, pw - 120, 1), x + 100, y + rh / 2 - 4, 24, st.text, { weight: 700, anchor: "start" });
        out += text(wrap(it.note, 17, pw - 120, 1), x + 100, y + rh / 2 + 24, 17, st.muted, { anchor: "start" });
      } else out += text(wrap(it.label, 26, pw - 120, 2), x + 100, y + rh / 2 + 9, 26, st.text, { weight: 700, anchor: "start" });
    });
  });
  const cx = SIZE.w / 2;
  const cy = top + ph / 2;
  out += `<circle cx="${cx}" cy="${cy}" r="38" fill="${st.palette[1 % st.palette.length]}"/>` + text(["VS"], cx, cy + 10, 28, "#ffffff", { weight: 800 });
  return out;
}

function layoutCycle(spec: InfographicSpec, st: VisualStyle): string {
  const n = spec.items.length;
  const cx = SIZE.w / 2;
  const cy = 420;
  const r = 190;
  const pos = spec.items.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + r * Math.cos(a) * 1.35, y: cy + r * Math.sin(a), a };
  });
  let out = `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.35}" ry="${r}" fill="none" stroke="${tint(st.palette[0], 0.6)}" stroke-width="6" stroke-dasharray="2 16" stroke-linecap="round"/>`;
  // 矢印（各ノードの間の中点に、進行方向の三角形）
  pos.forEach((p) => {
    // 楕円上の中間点での接線方向（時計回り）
    const ma = p.a + Math.PI / n;
    const mx = cx + r * 1.35 * Math.cos(ma);
    const my = cy + r * Math.sin(ma);
    const deg = (Math.atan2(r * Math.cos(ma), -r * 1.35 * Math.sin(ma)) * 180) / Math.PI;
    out += `<path d="M-12 -12 L12 0 L-12 12 Z" fill="${st.palette[0]}" transform="translate(${mx} ${my}) rotate(${deg})"/>`;
  });
  pos.forEach((p, i) => {
    const c = st.palette[i % st.palette.length];
    out += `<circle cx="${p.x}" cy="${p.y}" r="56" fill="${c}"/>` + icon(iconFor(spec.items[i], st), p.x, p.y, 52, "#ffffff");
    // 上下のノードはラベルを横に、左右のノードは下に置く（タイトルや画面の端と重ならないように）
    const side = Math.abs(Math.sin(p.a)) > 0.7;
    const right = Math.cos(p.a) >= -0.01;
    const lx = side ? p.x + (right ? 76 : -76) : p.x;
    const ly = side ? p.y + 6 : p.y + 92;
    const anchor = side ? (right ? "start" : "end") : "middle";
    out += text(wrap(spec.items[i].label, 24, 220, 1), lx, ly, 24, st.text, { weight: 700, anchor });
    if (spec.items[i].note) out += text(wrap(spec.items[i].note!, 16, 220, 1), lx, ly + 26, 16, st.muted, { anchor });
  });
  return out;
}

function layoutHierarchy(spec: InfographicSpec, st: VisualStyle): string {
  const [root, ...kids] = spec.items;
  const top = centerTop(120 + 120 + 210);
  const cx = SIZE.w / 2;
  let out = `<rect x="${cx - 200}" y="${top}" width="400" height="120" rx="${st.corner}" fill="${st.palette[0]}"/>`;
  out += icon(iconFor(root, st), cx - 140, top + 60, 52, "#ffffff") + text(wrap(root.label, 30, 270, 2), cx + 40, top + 72, 30, "#ffffff", { weight: 700 });
  const n = kids.length;
  const margin = 60;
  const gap = 28;
  const kw = (SIZE.w - margin * 2 - gap * (n - 1)) / Math.max(1, n);
  const ky = top + 240;
  out += `<path d="M${cx} ${top + 120} V${ky - 50}" stroke="${st.muted}" stroke-width="3" fill="none"/>`;
  if (n > 1) out += `<path d="M${margin + kw / 2} ${ky - 50} H${margin + (n - 1) * (kw + gap) + kw / 2}" stroke="${st.muted}" stroke-width="3" fill="none"/>`;
  kids.forEach((it, i) => {
    const x = margin + i * (kw + gap);
    const c = st.palette[(i + 1) % st.palette.length];
    const kx = x + kw / 2;
    out += `<path d="M${kx} ${ky - 50} V${ky}" stroke="${st.muted}" stroke-width="3" fill="none"/>`;
    out += `<rect x="${x}" y="${ky}" width="${kw}" height="210" rx="${st.corner}" fill="${tint(c, 0.88)}"/>`;
    out += `<circle cx="${kx}" cy="${ky + 60}" r="40" fill="${c}"/>` + icon(iconFor(it, st), kx, ky + 60, 40, "#ffffff");
    out += text(wrap(it.label, 24, kw - 24, 2), kx, ky + 140, 24, st.text, { weight: 700 });
    if (it.note) out += text(wrap(it.note, 16, kw - 24, 1), kx, ky + 180, 16, st.muted);
  });
  return out;
}

function layoutChart(spec: InfographicSpec, st: VisualStyle): string {
  const items = spec.items;
  const values = items.map((x) => x.value ?? 0);
  const unit = items.find((x) => x.unit)?.unit ?? "";
  if (spec.chart === "pie") {
    const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const cx = 400;
    const cy = 420;
    const R = 220;
    const r = 120;
    let a0 = -Math.PI / 2;
    let out = "";
    items.forEach((it, i) => {
      const frac = Math.max(0, values[i]) / total;
      const a1 = a0 + frac * 2 * Math.PI;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad: number, rr: number) => `${cx + rr * Math.cos(rad)} ${cy + rr * Math.sin(rad)}`;
      if (frac >= 0.999) out += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${st.palette[i % st.palette.length]}" stroke-width="${R - r}"/>`;
      else if (frac > 0) out += `<path d="M${p(a0, R)} A${R} ${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r} ${r} 0 ${large} 0 ${p(a0, r)} Z" fill="${st.palette[i % st.palette.length]}"/>`;
      a0 = a1;
    });
    // 中央の合計は単位があるときだけ（割合だけの円グラフでは意味がないため）
    if (unit) out += text([`${fmt(values.reduce((s, v) => s + v, 0))}${unit}`], cx, cy + 14, 40, st.text, { weight: 800 });
    const lh = Math.min(84, 470 / items.length);
    items.forEach((it, i) => {
      const y = cy - (items.length * lh) / 2 + i * lh;
      const c = st.palette[i % st.palette.length];
      out += `<circle cx="${740}" cy="${y + 20}" r="26" fill="${c}"/>` + icon(iconFor(it, st), 740, y + 20, 26, "#ffffff");
      out += text(wrap(it.label, 24, 300, 1), 784, y + 29, 24, st.text, { weight: 700, anchor: "start" });
      out += text([`${Math.round((Math.max(0, values[i]) / total) * 100)}%`], 1200, y + 30, 28, c, { weight: 800, anchor: "end" });
    });
    return out;
  }
  const left = 120;
  const right = SIZE.w - 80;
  const base = 560;
  const topY = 180;
  const max = Math.max(...values, 0) || 1;
  const step = (right - left) / items.length;
  const y = (v: number) => base - (Math.max(0, v) / max) * (base - topY);
  let out = `<path d="M${left} ${base} H${right}" stroke="${st.muted}" stroke-width="2"/>`;
  if (spec.chart === "line") {
    const pts = items.map((_, i) => `${left + step * (i + 0.5)} ${y(values[i])}`);
    out += `<path d="M${pts.join(" L")}" fill="none" stroke="${st.palette[0]}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  items.forEach((it, i) => {
    const cx = left + step * (i + 0.5);
    const c = st.palette[spec.chart === "line" ? 0 : i % st.palette.length];
    if (spec.chart === "line") out += `<circle cx="${cx}" cy="${y(values[i])}" r="12" fill="#ffffff" stroke="${c}" stroke-width="6"/>`;
    else {
      const bw = Math.min(110, step * 0.6);
      out += `<rect x="${cx - bw / 2}" y="${y(values[i])}" width="${bw}" height="${base - y(values[i])}" rx="${Math.min(12, st.corner / 2)}" fill="${c}"/>`;
    }
    out += text([`${fmt(values[i])}${unit}`], cx, y(values[i]) - 18, 26, st.text, { weight: 800 });
    out += icon(iconFor(it, st), cx, base + 42, 34, c);
    out += text(wrap(it.label, 20, step - 12, 2), cx, base + 92, 20, st.text, { weight: 700 });
  });
  return out;
}

/** 設計図 → SVG（1280×720） */
export function renderInfographicSvg(spec: InfographicSpec, styleIn?: Partial<VisualStyle> | null): string {
  const st = normalizeStyle(styleIn);
  const body =
    spec.type === "steps" ? layoutSteps(spec, st, true)
    : spec.type === "checklist" ? layoutChecklist(spec, st)
    : spec.type === "stat" ? layoutStat(spec, st)
    : spec.type === "compare" ? layoutCompare(spec, st)
    : spec.type === "cycle" ? layoutCycle(spec, st)
    : spec.type === "hierarchy" ? layoutHierarchy(spec, st)
    : layoutChart(spec, st);
  const titleLines = wrap(spec.title, 40, SIZE.w - 160, 1);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.w}" height="${SIZE.h}" viewBox="0 0 ${SIZE.w} ${SIZE.h}">`,
    `<rect width="100%" height="100%" fill="${st.background}"/>`,
    `<rect x="60" y="54" width="10" height="44" rx="5" fill="${st.palette[0]}"/>`,
    text(titleLines, 86, 91, 40, st.text, { weight: 800, anchor: "start" }),
    body,
    `</svg>`,
  ].join("");
}

/** SVG → PNG */
export function svgToPng(svg: string, width = SIZE.w): Uint8Array {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "Noto Sans CJK JP" },
  });
  return new Uint8Array(r.render().asPng());
}

export function renderInfographic(raw: Partial<InfographicSpec>, style?: Partial<VisualStyle> | null): { spec: InfographicSpec; issues: string[]; svg: string; png: Uint8Array } {
  const { spec, issues } = normalizeSpec(raw);
  const svg = renderInfographicSvg(spec, style);
  return { spec, issues, svg, png: svgToPng(svg) };
}
