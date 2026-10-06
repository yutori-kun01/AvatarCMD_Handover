// ================================================
// 図解用のアイコン（無料・商用可のセットを同梱。外部 CDN は使わない）
// ================================================
//   fa:     Font Awesome Free Solid / Regular（アイコン CC BY 4.0）
//   bi:     Bootstrap Icons（MIT）
//   lucide: Lucide（ISC）
// 名前は "fa:rocket" / "bi:lightning" / "lucide:rocket"。接頭辞なしは fa → bi → lucide の順で探す。
// 見つからない名前は近い名前（語の一部一致）→ 既定のアイコンに置き換える（AI が存在しない名前を出しても崩れない）。

import { existsSync, readdirSync, readFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
// Font Awesome は静的 import（Next.js のバンドルにも確実に入る）
import * as faSolid from "@fortawesome/free-solid-svg-icons";
import * as faRegular from "@fortawesome/free-regular-svg-icons";

export interface IconSvg {
  /** 解決したアイコン名（例: fa:rocket） */
  name: string;
  viewBox: string;
  /** <svg> の中身。色は currentColor */
  body: string;
  /** 線のアイコン（lucide）か */
  stroke: boolean;
}

type FaDef = { iconName: string; prefix: string; icon: [number, number, string[], string, string | string[]] };
let faMap: Map<string, FaDef> | null = null;

function loadFa(): Map<string, FaDef> {
  if (faMap) return faMap;
  faMap = new Map();
  for (const mod of [faSolid, faRegular] as Record<string, unknown>[]) {
    for (const v of Object.values(mod)) {
      const d = v as FaDef;
      if (!d || typeof d !== "object" || !d.iconName || !Array.isArray(d.icon)) continue;
      // solid を優先（regular は solid に無い名前だけ）
      for (const n of [d.iconName, ...(d.icon[2] ?? []).filter((x): x is string => typeof x === "string")]) if (!faMap.has(n)) faMap.set(n, d);
    }
  }
  return faMap;
}

/**
 * SVG ファイルのあるパッケージの場所。通常は require.resolve で、バンドル後（Next.js の standalone 出力など）で
 * 解決できない場合は、作業ディレクトリから上に node_modules（pnpm の .pnpm も）を探す。
 */
function pkgDir(pkg: "bootstrap-icons" | "lucide-static"): string | null {
  try {
    const req = createRequire(import.meta.url);
    const p = pkg === "bootstrap-icons" ? req.resolve("bootstrap-icons/package.json") : req.resolve("lucide-static/package.json");
    if (existsSync(path.join(path.dirname(p), "icons"))) return path.dirname(p);
  } catch {
    // 下の探索へ
  }
  let dir = process.cwd();
  for (;;) {
    const direct = path.join(dir, "node_modules", pkg);
    if (existsSync(path.join(direct, "icons"))) return direct;
    const pnpm = path.join(dir, "node_modules", ".pnpm");
    if (existsSync(pnpm)) {
      const hit = readdirSync(pnpm).find((d) => d.startsWith(`${pkg}@`));
      if (hit && existsSync(path.join(pnpm, hit, "node_modules", pkg, "icons"))) return path.join(pnpm, hit, "node_modules", pkg);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const dirs = { bi: null as string | null | undefined, lucide: null as string | null | undefined };
function iconFile(set: "bi" | "lucide", name: string): string | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  if (dirs[set] === null || dirs[set] === undefined) dirs[set] = pkgDir(set === "bi" ? "bootstrap-icons" : "lucide-static");
  const d = dirs[set];
  if (!d) return null;
  const f = path.join(d, "icons", `${name}.svg`);
  return existsSync(f) ? f : null;
}

function fromFile(set: "bi" | "lucide", name: string): IconSvg | null {
  const f = iconFile(set, name);
  if (!f) return null;
  const raw = readFileSync(f, "utf-8");
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? (set === "bi" ? "0 0 16 16" : "0 0 24 24");
  const body = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  return { name: `${set}:${name}`, viewBox, body, stroke: set === "lucide" };
}

function fromFa(name: string): IconSvg | null {
  const d = loadFa().get(name);
  if (!d) return null;
  const [w, h, , , p] = d.icon;
  const paths = (Array.isArray(p) ? p : [p]).map((x) => `<path d="${x}"/>`).join("");
  return { name: `fa:${d.iconName}`, viewBox: `0 0 ${w} ${h}`, body: paths, stroke: false };
}

/** 存在すればアイコンを返す（置き換えなし） */
export function findIcon(raw: string): IconSvg | null {
  // "fas:rocket" "fa-solid fa-rocket" "fa-rocket" "bi-lightning" なども受け付ける
  const s = raw.trim().toLowerCase().replace(/^fa[srb]:/, "fa:").replace(/^fa-(solid|regular)\s+/, "");
  const m = /^(fa|bi|lucide):(.+)$/.exec(s);
  const name = (m ? m[2] : s).replace(/^(fa|bi)-/, "");
  if (m?.[1] === "fa") return fromFa(name);
  if (m?.[1] === "bi") return fromFile("bi", name);
  if (m?.[1] === "lucide") return fromFile("lucide", name);
  return fromFa(name) ?? fromFile("bi", name) ?? fromFile("lucide", name);
}

let regularMap: Map<string, FaDef> | null = null;
/** Font Awesome Regular（線のアイコン）。無料版にある名前だけ */
export function findRegular(raw: string): IconSvg | null {
  if (!regularMap) {
    regularMap = new Map();
    for (const v of Object.values(faRegular as Record<string, unknown>)) {
      const d = v as FaDef;
      if (d && typeof d === "object" && d.iconName && Array.isArray(d.icon)) regularMap.set(d.iconName, d);
    }
  }
  const d = regularMap.get(raw.trim().toLowerCase().replace(/^fa-/, ""));
  if (!d) return null;
  const [w, h, , , p] = d.icon;
  return { name: `fa-regular:${d.iconName}`, viewBox: `0 0 ${w} ${h}`, body: (Array.isArray(p) ? p : [p]).map((x) => `<path d="${x}"/>`).join(""), stroke: false };
}

export const FALLBACK_ICON = "fa:circle-info";

/** アイコンを解決する。無ければ語の一部が一致する Font Awesome のアイコン、それも無ければ既定のアイコン */
export function resolveIcon(raw: string | undefined | null): IconSvg {
  const exact = raw ? findIcon(raw) : null;
  if (exact) return exact;
  const words = String(raw ?? "")
    .toLowerCase()
    .replace(/^[a-z]+:/, "")
    .split(/[-_\s]+/)
    .filter((w) => w.length >= 3);
  const fa = loadFa();
  for (const w of words) {
    if (fa.has(w)) return fromFa(w)!;
    const hit = [...fa.keys()].find((k) => k.split("-").includes(w));
    if (hit) return fromFa(hit)!;
  }
  return findIcon(FALLBACK_ICON)!;
}
