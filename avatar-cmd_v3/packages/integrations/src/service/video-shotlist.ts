// ================================================
// 動画パイプライン — カット指示書（shotlist）の型とルール（DB を使わない純粋な関数）
// ================================================
// カット指示書が唯一の正。台本生成と同時に作り、以後すべての工程がこれを読み書きする。
// 各工程は自分の担当フィールドだけを更新する（patchShot で担当外の更新を拒否する）。

export const EPISODE_FORMATS = ["深掘り回", "体験談回", "ランキング回", "前後編"] as const;
export type EpisodeFormat = (typeof EPISODE_FORMATS)[number];

export const VISUAL_STYLES = ["illustration", "anime", "document"] as const;
export type ShotVisualStyle = (typeof VISUAL_STYLES)[number];

export const MOTION_TYPES = ["i2v", "pseudo", "static"] as const;
export type MotionType = (typeof MOTION_TYPES)[number];

/** カットの状態。承認・合格のたびに進める（戻すときは review_note に理由） */
export const SHOT_STATUSES = ["draft", "storyboard_ok", "final_ok", "video_ok", "rendered"] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

export const EXPRESSIONS = ["通常", "驚き", "考え中", "笑顔", "怖がり", "真剣"] as const;

export type QcResult = "pass" | "retry" | "hold";
export type QcReason = "face_mismatch" | "text_found" | "hand_broken" | "composition" | "other";

export interface ShotQc {
  /** 検品した段階（storyboard / final / video） */
  phase: string | null;
  result: QcResult | null;
  confidence: number | null;
  /** 判定したもの（jev / claude / human / none） */
  engine: string | null;
  reason: QcReason | null;
  note: string | null;
  /** VPS の計測値 */
  scores: Record<string, unknown>;
  retries: number;
}

export interface Shot {
  shot_id: string;
  chapter_id: string;
  narration: string;
  visual: {
    description: string;
    composition: string;
    character: boolean;
    expression: string | null;
    style: ShotVisualStyle;
    realistic: boolean;
  };
  motion_type: MotionType;
  motion_note: string;
  /** 擬似アニメの動き（zoom_in / zoom_out / pan_left / pan_right / parallax）。pseudo のとき自動で割り当てる */
  pseudo_motion?: string | null;
  duration_sec: number;
  /** duration_sec がナレーションのタイムスタンプで確定したか（false は文字数からの見積もり） */
  duration_fixed?: boolean;
  short_candidate: { is_candidate: boolean; hook_rank: number | null; note: string | null };
  subtitle_emphasis: string[];
  bgm_mood: string;
  checks: string[];
  status: ShotStatus;
  /** 絵コンテ承認（承認 C）の結果。pending / approved / rejected */
  storyboard_review: "pending" | "approved" | "rejected";
  assets: { storyboard: string | null; final_image: string | null; video: string | null };
  qc: ShotQc;
  review_note: string | null;
}

export interface Chapter {
  chapter_id: string;
  title: string;
  shot_ids: string[];
}

export interface Shotlist {
  episode_id: string;
  title_candidates: string[];
  format: EpisodeFormat | null;
  target_minutes: number;
  sources: { label: string; url: string }[];
  chapters: Chapter[];
  shots: Shot[];
}

// --- 正規化（LLM の出力や画面からの入力を型にそろえる） ----------------------------

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const pad = (n: number, w = 3) => String(n).padStart(w, "0");

export function emptyQc(): ShotQc {
  return { phase: null, result: null, confidence: null, engine: null, reason: null, note: null, scores: {}, retries: 0 };
}

/** 文字数からの尺の見積もり（1 分あたり約 300 字）。ナレーション生成後にタイムスタンプで確定する */
export function estimateSeconds(text: string): number {
  const chars = text.replace(/\s/g, "").length;
  return Math.max(2, Math.round((chars / 300) * 60 * 10) / 10);
}

export function normalizeShot(raw: any, index: number, chapterId: string): Shot {
  const v = raw?.visual ?? {};
  const narration = str(raw?.narration);
  const motion = oneOf(raw?.motion_type, MOTION_TYPES, "pseudo");
  const sc = raw?.short_candidate ?? {};
  const qc = raw?.qc ?? {};
  return {
    shot_id: str(raw?.shot_id, 20) || `s${pad(index + 1)}`,
    chapter_id: str(raw?.chapter_id, 20) || chapterId,
    narration,
    visual: {
      description: str(v.description),
      composition: str(v.composition, 1000),
      character: v.character === true,
      expression: str(v.expression, 20) || null,
      style: oneOf(v.style, VISUAL_STYLES, "illustration"),
      realistic: v.realistic === true,
    },
    motion_type: motion,
    motion_note: str(raw?.motion_note, 1000),
    pseudo_motion: str(raw?.pseudo_motion, 20) || null,
    duration_sec: typeof raw?.duration_sec === "number" && raw.duration_sec > 0 ? Math.round(raw.duration_sec * 10) / 10 : estimateSeconds(narration),
    duration_fixed: raw?.duration_fixed === true,
    short_candidate: {
      is_candidate: sc.is_candidate === true,
      hook_rank: typeof sc.hook_rank === "number" ? sc.hook_rank : null,
      note: str(sc.note, 500) || null,
    },
    subtitle_emphasis: Array.isArray(raw?.subtitle_emphasis) ? raw.subtitle_emphasis.map((x: unknown) => str(x, 40)).filter(Boolean).slice(0, 10) : [],
    bgm_mood: str(raw?.bgm_mood, 40),
    checks: Array.isArray(raw?.checks) && raw.checks.length ? raw.checks.map((x: unknown) => str(x, 200)).filter(Boolean).slice(0, 10) : defaultChecks(v.character === true),
    status: oneOf(raw?.status, SHOT_STATUSES, "draft"),
    storyboard_review: oneOf(raw?.storyboard_review, ["pending", "approved", "rejected"] as const, "pending"),
    assets: {
      storyboard: str(raw?.assets?.storyboard, 100) || null,
      final_image: str(raw?.assets?.final_image, 100) || null,
      video: str(raw?.assets?.video, 100) || null,
    },
    qc: {
      phase: str(qc.phase, 20) || null,
      result: oneOf(qc.result, ["pass", "retry", "hold"] as const, null as never) ?? null,
      confidence: typeof qc.confidence === "number" ? qc.confidence : null,
      engine: str(qc.engine, 20) || null,
      reason: oneOf(qc.reason, ["face_mismatch", "text_found", "hand_broken", "composition", "other"] as const, null as never) ?? null,
      note: str(qc.note, 1000) || null,
      scores: qc.scores && typeof qc.scores === "object" ? qc.scores : {},
      retries: typeof qc.retries === "number" ? qc.retries : 0,
    },
    review_note: str(raw?.review_note, 2000) || null,
  };
}

export function defaultChecks(character: boolean): string[] {
  return [...(character ? ["顔が設定書と一致", "手指の破綻なし"] : []), "画面内に文字なし", "構図が指示どおり"];
}

/** カット指示書全体を正規化する。章が無いカットは章を作って入れる。カット ID の重複は振り直す */
export function normalizeShotlist(raw: any, episodeId: string): Shotlist {
  const chaptersRaw: any[] = Array.isArray(raw?.chapters) ? raw.chapters : [];
  const shotsRaw: any[] = Array.isArray(raw?.shots) ? raw.shots : [];
  const chapters: Chapter[] = chaptersRaw.map((c, i) => ({
    chapter_id: str(c?.chapter_id, 20) || `ch${pad(i + 1, 2)}`,
    title: str(c?.title, 200) || `第${i + 1}章`,
    shot_ids: Array.isArray(c?.shot_ids) ? c.shot_ids.map((x: unknown) => str(x, 20)).filter(Boolean) : [],
  }));
  if (!chapters.length) chapters.push({ chapter_id: "ch01", title: "本編", shot_ids: [] });
  const seen = new Set<string>();
  const shots = shotsRaw.map((s, i) => {
    const shot = normalizeShot(s, i, chapters[0].chapter_id);
    if (seen.has(shot.shot_id)) shot.shot_id = `s${pad(i + 1)}x`;
    seen.add(shot.shot_id);
    if (!chapters.some((c) => c.chapter_id === shot.chapter_id)) shot.chapter_id = chapters[0].chapter_id;
    return shot;
  });
  // 章のカット一覧はカットの chapter_id から作り直す（指示書の中で食い違わないように）
  for (const c of chapters) c.shot_ids = shots.filter((s) => s.chapter_id === c.chapter_id).map((s) => s.shot_id);
  return {
    episode_id: episodeId,
    title_candidates: Array.isArray(raw?.title_candidates) ? raw.title_candidates.map((x: unknown) => str(x, 100)).filter(Boolean).slice(0, 5) : [],
    format: (EPISODE_FORMATS as readonly string[]).includes(raw?.format) ? raw.format : null,
    target_minutes: typeof raw?.target_minutes === "number" && raw.target_minutes > 0 ? raw.target_minutes : 15,
    sources: Array.isArray(raw?.sources)
      ? raw.sources.map((s: any) => ({ label: str(s?.label, 200), url: str(s?.url, 1000) })).filter((s: { url: string }) => /^https?:\/\//.test(s.url))
      : [],
    chapters,
    shots,
  };
}

// --- 検証 -----------------------------------------------------------------------

export interface ShotlistLimits {
  /** 1 本あたりの動画化（i2v）カット数の上限 */
  maxI2vShots: number;
  /** ショート候補のカット数（null なら検証しない） */
  shortCandidates: { min: number; max: number } | null;
}

export interface ShotlistIssues {
  errors: string[];
  warnings: string[];
}

export function validateShotlist(sl: Shotlist, limits: ShotlistLimits): ShotlistIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!sl.shots.length) errors.push("カットがありません");
  for (const s of sl.shots) {
    if (!s.narration) errors.push(`${s.shot_id}: セリフ（narration）が空です`);
    if (!s.visual.description) errors.push(`${s.shot_id}: 何を描くか（visual.description）が空です`);
  }
  const i2v = sl.shots.filter((s) => s.motion_type === "i2v").length;
  if (i2v > limits.maxI2vShots) warnings.push(`動画化（i2v）のカットが ${i2v} 件あり、上限 ${limits.maxI2vShots} 件を超えています。超える分は擬似アニメ（pseudo）への切り替えを提案します`);
  if (limits.shortCandidates) {
    const n = sl.shots.filter((s) => s.short_candidate.is_candidate).length;
    if (n < limits.shortCandidates.min || n > limits.shortCandidates.max) warnings.push(`ショート候補が ${n} カットです（目安 ${limits.shortCandidates.min}〜${limits.shortCandidates.max} カット）`);
  }
  if (!sl.sources.length) warnings.push("出典（sources）がありません。出典のない話は「〜という説がある」と書いてください");
  if (sl.title_candidates.length < 3) warnings.push("タイトル候補が 3 件未満です");
  return { errors, warnings };
}

/** i2v の上限を超える分（後ろのカットから）を pseudo に切り替える案 */
export function proposePseudoFallback(sl: Shotlist, maxI2v: number): string[] {
  const i2v = sl.shots.filter((s) => s.motion_type === "i2v");
  return i2v.slice(maxI2v).map((s) => s.shot_id);
}

/**
 * 回の型のローテーション。直近の回（新しい順）と比べ、同じ型が 3 本連続になる場合はエラー、
 * 直前と同じなら警告（指示書: 直近と同じ型を連続させない・同じ型を 3 本連続させない）
 */
export function formatRotationIssue(format: string | null, recentFormats: (string | null)[]): { level: "error" | "warning"; message: string } | null {
  if (!format) return null;
  const [prev1, prev2] = recentFormats;
  if (prev1 === format && prev2 === format) return { level: "error", message: `「${format}」が 3 本連続になります。別の型にしてください` };
  if (prev1 === format) return { level: "warning", message: `直前の回も「${format}」です。できれば別の型にしてください` };
  return null;
}

/** 実写と見間違えるカットが 1 つでもあれば、改変・合成コンテンツの開示が必要 */
export function needsDisclosure(sl: Shotlist): boolean {
  return sl.shots.some((s) => s.visual.realistic);
}

// --- 工程ごとの担当フィールド ------------------------------------------------------------

/** 工程ごとに更新してよいカットのフィールド（指示書: 各工程は自分の担当フィールドだけを更新する） */
export const STEP_FIELDS = {
  script: ["narration", "visual", "motion_type", "motion_note", "short_candidate", "subtitle_emphasis", "bgm_mood", "checks", "chapter_id"],
  narration: ["duration_sec", "duration_fixed"],
  storyboard: ["assets", "qc", "status", "storyboard_review"],
  storyboard_review: ["storyboard_review", "status", "review_note", "qc"],
  final: ["assets", "qc", "status"],
  video: ["assets", "qc", "status", "pseudo_motion", "motion_type"],
  render: ["status"],
  human: ["narration", "visual", "motion_type", "motion_note", "short_candidate", "subtitle_emphasis", "bgm_mood", "checks", "review_note"],
} as const satisfies Record<string, readonly (keyof Shot)[]>;
export type ShotStep = keyof typeof STEP_FIELDS;

/** 工程の担当フィールドだけを更新した新しいカットを返す。担当外のフィールドが含まれていればエラー */
export function patchShot(shot: Shot, step: ShotStep, patch: Partial<Shot>): Shot {
  const allowed = new Set<string>(STEP_FIELDS[step]);
  const bad = Object.keys(patch).filter((k) => !allowed.has(k));
  if (bad.length) throw new Error(`工程「${step}」は ${bad.join(", ")} を更新できません（担当外のフィールド）`);
  const next: Shot = { ...shot, ...patch };
  if (patch.assets) next.assets = { ...shot.assets, ...patch.assets };
  if (patch.qc) next.qc = { ...shot.qc, ...patch.qc };
  if (patch.visual) next.visual = { ...shot.visual, ...patch.visual };
  if (patch.status && SHOT_STATUSES.indexOf(patch.status) > SHOT_STATUSES.indexOf(shot.status) + 1) {
    throw new Error(`${shot.shot_id}: 状態を ${shot.status} から ${patch.status} へ飛ばして進めることはできません`);
  }
  return next;
}

// --- ナレーションのタイムスタンプ → 尺・字幕 ------------------------------------------------

export interface WordTiming {
  text: string;
  /** 秒 */
  start: number;
  end: number;
}

export interface ShotTiming {
  shot_id: string;
  start: number;
  end: number;
}

/**
 * 各カットのセリフを文字数の比率で単語タイムスタンプに割り当て、開始・終了時刻を求める。
 * 文字起こしの単語区切りと台本の区切りは一致しないため、累積文字数で対応づける（台本の文字が正）。
 */
export function alignShots(shots: Pick<Shot, "shot_id" | "narration">[], words: WordTiming[], offset = 0): ShotTiming[] {
  if (!words.length) return [];
  const clean = (t: string) => t.replace(/[\s、。，．,.!?！？「」『』（）()…・ー―-]/g, "");
  const wordChars = words.map((w) => Math.max(1, clean(w.text).length));
  const totalWordChars = wordChars.reduce((a, b) => a + b, 0);
  const shotChars = shots.map((s) => Math.max(1, clean(s.narration).length));
  const totalShotChars = shotChars.reduce((a, b) => a + b, 0);
  const cum: { at: number; start: number }[] = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    cum.push({ at: acc / totalWordChars, start: words[i].start });
    acc += wordChars[i];
  }
  /** 文字の位置（0〜1）にあたる単語の開始時刻 */
  const timeAt = (ratio: number) => {
    if (ratio <= 0) return words[0].start;
    if (ratio >= 1) return words[words.length - 1].end;
    let idx = cum.findIndex((c) => c.at > ratio) - 1;
    if (idx < 0) idx = cum.length - 1;
    return cum[idx].start;
  };
  const out: ShotTiming[] = [];
  let pos = 0;
  for (let i = 0; i < shots.length; i++) {
    const startRatio = pos / totalShotChars;
    pos += shotChars[i];
    const endRatio = pos / totalShotChars;
    const start = timeAt(startRatio);
    const end = i === shots.length - 1 ? words[words.length - 1].end : Math.max(start + 0.1, timeAt(endRatio));
    out.push({ shot_id: shots[i].shot_id, start: round(start + offset), end: round(end + offset) });
  }
  // 隣のカットとすき間・重なりが出ないよう、次の開始を前の終了にそろえる
  for (let i = 1; i < out.length; i++) out[i - 1].end = out[i].start;
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** 字幕 1 枚分の区切り（全角 16 文字 × 2 行まで）。句読点・助詞の後ろで切ることを優先する */
export function splitSubtitle(text: string, perLine = 16, lines = 2): string[][] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const cap = perLine * lines;
  const pages: string[][] = [];
  let rest = t;
  while (rest.length) {
    let cut = rest.length <= cap ? rest.length : bestBreak(rest, cap);
    const page = rest.slice(0, cut).trim();
    rest = rest.slice(cut).trim();
    const pageLines: string[] = [];
    let p = page;
    while (p.length) {
      const c = p.length <= perLine ? p.length : bestBreak(p, perLine);
      pageLines.push(p.slice(0, c).trim());
      p = p.slice(c).trim();
    }
    // 3 行以上になった場合は次のページに回す
    if (pageLines.length > lines) {
      pages.push(pageLines.slice(0, lines));
      rest = `${pageLines.slice(lines).join("")}${rest}`;
    } else pages.push(pageLines);
    if (cut === 0) break;
  }
  return pages;
}

function bestBreak(s: string, max: number): number {
  const window = s.slice(0, max + 1);
  for (const re of [/[。！？!?]/g, /[、，,]/g, /[はがをにでともへや]/g]) {
    let last = -1;
    for (const m of window.matchAll(re)) if (m.index! < max) last = m.index!;
    if (last >= Math.floor(max / 2)) return last + 1;
  }
  return max;
}

export interface Cue {
  start: number;
  end: number;
  lines: string[];
}

/** カットのセリフと開始・終了時刻から字幕の区切りを作る（ページの長さは文字数で按分） */
export function buildCues(shots: Pick<Shot, "shot_id" | "narration">[], timings: ShotTiming[], perLine = 16, lines = 2): Cue[] {
  const cues: Cue[] = [];
  for (const s of shots) {
    const t = timings.find((x) => x.shot_id === s.shot_id);
    if (!t) continue;
    const pages = splitSubtitle(s.narration, perLine, lines);
    const total = pages.reduce((a, p) => a + p.join("").length, 0) || 1;
    let at = t.start;
    for (const p of pages) {
      const dur = ((t.end - t.start) * p.join("").length) / total;
      cues.push({ start: round(at), end: round(at + dur), lines: p });
      at += dur;
    }
  }
  return cues;
}

const srtTime = (sec: number) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join("\n")}\n`).join("\n");
}

/** YouTube 概要欄のチャプター（0:00 から始まる。章の開始時刻） */
export function chapterTimestamps(sl: Shotlist, timings: ShotTiming[]): string[] {
  const fmt = (sec: number) => {
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
  };
  const out: string[] = [];
  for (const c of sl.chapters) {
    const first = timings.find((t) => t.shot_id === c.shot_ids[0]);
    if (!first) continue;
    out.push(`${fmt(out.length ? first.start : 0)} ${c.title}`);
  }
  return out;
}

// --- 擬似アニメの動き ---------------------------------------------------------------

export const PSEUDO_MOTIONS = ["zoom_in", "pan_left", "zoom_out", "pan_right", "parallax"] as const;

/** pseudo のカットに動きを割り当てる。同じ動きを 3 カット以上連続させない（直前 2 つと違う動きを選ぶ） */
export function assignPseudoMotions(shots: Shot[]): Shot[] {
  const out: Shot[] = [];
  let i = 0;
  for (const s of shots) {
    if (s.motion_type !== "pseudo") {
      out.push(s);
      continue;
    }
    const prev = out.filter((x) => x.motion_type === "pseudo").slice(-2).map((x) => x.pseudo_motion);
    let m = s.pseudo_motion && (PSEUDO_MOTIONS as readonly string[]).includes(s.pseudo_motion) ? s.pseudo_motion : PSEUDO_MOTIONS[i % PSEUDO_MOTIONS.length];
    if (prev.length === 2 && prev[0] === m && prev[1] === m) m = PSEUDO_MOTIONS.find((x) => x !== m)!;
    out.push({ ...s, pseudo_motion: m });
    i++;
  }
  return out;
}

// --- 画像プロンプト ---------------------------------------------------------------

/** 画像生成のプロンプト（画風ガイド → キャラ設定書 → カットの内容と構図の順。指示書 6-3） */
export function shotImagePrompt(shot: Shot, guide: { style?: string; character?: string }): string {
  const parts = [
    guide.style ? `【画風】${guide.style}` : "",
    shot.visual.character && guide.character ? `【キャラクター設定（この設定を必ず守る）】${guide.character}` : "",
    shot.visual.character && shot.visual.expression ? `【表情】${shot.visual.expression}` : "",
    `【描く内容】${shot.visual.description}`,
    shot.visual.composition ? `【構図】${shot.visual.composition}` : "",
    "【画角】正方形。主役は画面中央 60% の範囲に収める（横長 16:9・縦長 9:16 に切り出すため）。",
    shot.visual.style === "document" ? "【様式】資料・図版風のイラスト。" : `【様式】${shot.visual.style === "anime" ? "アニメ調" : "イラスト調"}。実写と見間違える表現にしない。`,
    "画面内に文字・ロゴ・透かしを入れない。実在の人物・既存のアニメやゲームのキャラクターに似せない。",
  ];
  return parts.filter(Boolean).join("\n");
}
