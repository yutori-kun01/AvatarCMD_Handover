// ================================================
// 動画パイプライン — フォーマット設定と出力先（媒体）設定
// ================================================
// 指示書（docs/VIDEO_PIPELINE.md）の「共通の中核」は全動画で同じ。動画の種類による違いはフォーマット設定、
// 媒体による違い（画角・尺・字幕の位置・開示・投稿 API）は出力先設定に閉じ込める。
// 数値は 2026-10 時点の各社の公開情報にもとづく目安。変わったらここだけ直す。

export type VideoProfileId = "long_with_clips" | "vertical_only" | "ad";
export type VideoTargetId = "youtube_long" | "youtube_shorts" | "tiktok" | "ig_reels";

export interface VideoProfile {
  id: VideoProfileId;
  label: string;
  help: string;
  /** 台本の目安の長さ（分） */
  minutes: { min: number; max: number; default: number };
  /** 選べる出力先と既定 */
  targets: VideoTargetId[];
  defaultTargets: VideoTargetId[];
  /** ネタ候補（承認 A）を使うか。広告は依頼内容が決まっているので使わない */
  topics: boolean;
  /** 人が書く考察パート（承認 B で確認）を必須にするか */
  humanInsight: boolean;
  /** ショート候補のカット数（長尺から切り出すときだけ） */
  shortCandidates: { min: number; max: number } | null;
}

export const VIDEO_PROFILES: Record<VideoProfileId, VideoProfile> = {
  long_with_clips: {
    id: "long_with_clips",
    label: "長尺＋切り抜き",
    help: "YouTube の長尺（10〜20分）を作り、そこからショート / TikTok / リールを切り出す",
    minutes: { min: 8, max: 25, default: 15 },
    targets: ["youtube_long", "youtube_shorts", "tiktok", "ig_reels"],
    defaultTargets: ["youtube_long", "youtube_shorts", "tiktok"],
    topics: true,
    humanInsight: true,
    shortCandidates: { min: 3, max: 5 },
  },
  vertical_only: {
    id: "vertical_only",
    label: "縦型専用",
    help: "最初から縦型（15〜90秒）で作る。ショート / TikTok / リールに同じ動画を出す",
    minutes: { min: 0.25, max: 3, default: 1 },
    targets: ["youtube_shorts", "tiktok", "ig_reels"],
    defaultTargets: ["youtube_shorts", "tiktok", "ig_reels"],
    topics: true,
    humanInsight: false,
    shortCandidates: null,
  },
  ad: {
    id: "ad",
    label: "広告・PR",
    help: "商品・サービスの PR 動画。依頼内容から台本を作る（ネタ候補は使わない）",
    minutes: { min: 0.25, max: 3, default: 0.5 },
    targets: ["youtube_long", "youtube_shorts", "tiktok", "ig_reels"],
    defaultTargets: ["youtube_shorts", "tiktok", "ig_reels"],
    topics: false,
    humanInsight: false,
    shortCandidates: null,
  },
};

export interface VideoTarget {
  id: VideoTargetId;
  label: string;
  /** 投稿に使うプラットフォーム（platforms/*） */
  platform: "youtube" | "tiktok" | "instagram";
  width: number;
  height: number;
  /** 尺の上限（秒）。目安 */
  maxSeconds: number;
  /** 推奨の尺（秒） */
  recommendedSeconds: { min: number; max: number };
  /** 字幕を画面に焼き込むか（長尺は SRT を別に登録） */
  burnCaptions: boolean;
  /**
   * 字幕・テロップを置かない範囲（画面に対する割合）。UI（いいね・説明文など）が重なる位置
   * top / bottom / right は端からの割合
   */
  safeZone: { top: number; bottom: number; right: number };
  /** API で予約公開できるか（できない媒体は Avatar CMD の予約投稿で指定日時に送る） */
  apiSchedule: boolean;
  /** AI 生成の開示を API で付けられるか */
  aiLabelViaApi: boolean;
  notes: string[];
}

export const VIDEO_TARGETS: Record<VideoTargetId, VideoTarget> = {
  youtube_long: {
    id: "youtube_long",
    label: "YouTube 長尺",
    platform: "youtube",
    width: 1920,
    height: 1080,
    maxSeconds: 12 * 3600,
    recommendedSeconds: { min: 480, max: 1500 },
    burnCaptions: false,
    safeZone: { top: 0, bottom: 0.1, right: 0 },
    apiSchedule: true,
    aiLabelViaApi: false,
    notes: ["非公開でアップロードし publishAt で予約公開", "字幕は SRT を captions.insert で登録", "改変・合成コンテンツの開示は Studio で人が設定"],
  },
  youtube_shorts: {
    id: "youtube_shorts",
    label: "YouTube ショート",
    platform: "youtube",
    width: 1080,
    height: 1920,
    maxSeconds: 180,
    recommendedSeconds: { min: 15, max: 60 },
    burnCaptions: true,
    safeZone: { top: 0.1, bottom: 0.25, right: 0.15 },
    apiSchedule: true,
    aiLabelViaApi: false,
    notes: ["縦 9:16・3分以内でショートとして扱われる", "非公開でアップロードし publishAt で予約公開"],
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    platform: "tiktok",
    width: 1080,
    height: 1920,
    maxSeconds: 600,
    recommendedSeconds: { min: 15, max: 60 },
    burnCaptions: true,
    safeZone: { top: 0.1, bottom: 0.3, right: 0.17 },
    apiSchedule: false,
    aiLabelViaApi: true,
    notes: ["投稿前に公開範囲・コメント/デュエット/リミックスの可否を示して同意を得る（承認 D）", "AI 生成ラベル（is_aigc）を付ける", "監査前は下書き（受信トレイ）で送り、人がアプリで公開", "宣伝用のロゴ・透かしを入れない"],
  },
  ig_reels: {
    id: "ig_reels",
    label: "Instagram リール",
    platform: "instagram",
    width: 1080,
    height: 1920,
    maxSeconds: 900,
    recommendedSeconds: { min: 15, max: 90 },
    burnCaptions: true,
    safeZone: { top: 0.1, bottom: 0.28, right: 0.15 },
    apiSchedule: false,
    aiLabelViaApi: false,
    notes: ["動画は公開URLから取り込まれる（処理が終わるまで公開URLを止めない）", "API に予約公開が無いため、Avatar CMD の予約投稿で指定日時に送る", "他媒体のロゴ・透かし入りの動画は表示が減るため入れない", "流行りの音源は API から使えないので BGM は焼き込み"],
  },
};

export function isVideoProfile(v: unknown): v is VideoProfileId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(VIDEO_PROFILES, v);
}

export function isVideoTarget(v: unknown): v is VideoTargetId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(VIDEO_TARGETS, v);
}

/** フォーマットで選べない出力先・重複を取り除く。空なら既定 */
export function normalizeTargets(profile: VideoProfileId, raw: unknown): VideoTargetId[] {
  const allowed = VIDEO_PROFILES[profile].targets;
  const list = Array.isArray(raw) ? raw.filter((t): t is VideoTargetId => isVideoTarget(t) && allowed.includes(t)) : [];
  const uniq = [...new Set(list)];
  return uniq.length ? uniq : [...VIDEO_PROFILES[profile].defaultTargets];
}
