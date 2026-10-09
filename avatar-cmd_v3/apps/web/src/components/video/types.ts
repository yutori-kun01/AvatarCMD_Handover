// 動画パイプラインの画面で使う型（API の応答の形）

export interface MediaRef {
  name: string;
  mimeType: string;
  size: number;
  filename: string;
}

export interface ShotQc {
  phase: string | null;
  result: "pass" | "retry" | "hold" | null;
  confidence: number | null;
  engine: string | null;
  reason: string | null;
  note: string | null;
  scores: Record<string, unknown>;
  retries: number;
}

export interface Shot {
  shot_id: string;
  chapter_id: string;
  narration: string;
  visual: { description: string; composition: string; character: boolean; expression: string | null; style: string; realistic: boolean };
  motion_type: "i2v" | "pseudo" | "static";
  motion_note: string;
  pseudo_motion?: string | null;
  duration_sec: number;
  duration_fixed?: boolean;
  short_candidate: { is_candidate: boolean; hook_rank: number | null; note: string | null };
  subtitle_emphasis: string[];
  bgm_mood: string;
  checks: string[];
  status: string;
  storyboard_review: "pending" | "approved" | "rejected";
  assets: { storyboard: string | null; final_image: string | null; video: string | null };
  qc: ShotQc;
  review_note: string | null;
}

export interface Shotlist {
  episode_id: string;
  title_candidates: string[];
  format: string | null;
  target_minutes: number;
  sources: { label: string; url: string }[];
  chapters: { chapter_id: string; title: string; shot_ids: string[] }[];
  shots: Shot[];
}

export interface Report {
  what: string;
  where: string;
  tried: string;
  choices: string[];
  at: string;
}

export interface EpisodeSummary {
  id: string;
  episodeKey: string;
  title: string;
  avatarId: string;
  avatarName: string;
  profile: string;
  format: string | null;
  targets: string[];
  stage: string;
  stageLabel: string;
  gate: string | null;
  status: string;
  shots: number;
  report: Report | null;
  createdAt: string;
}

export interface Episode {
  id: string;
  episodeKey: string;
  title: string;
  avatarId: string;
  avatarName: string;
  profile: string;
  profileLabel: string;
  format: string | null;
  targets: string[];
  stage: string;
  stageLabel: string;
  stages: { id: string; label: string; gate?: string }[];
  status: string;
  theme: string | null;
  topics: { title: string; angle: string; sources: { label: string; url: string; ok?: boolean }[] }[];
  script: string | null;
  shotlist: Shotlist;
  issues: { errors: string[]; warnings: string[] };
  pseudoFallback: string[];
  disclosure: boolean;
  insightMarker: string | null;
  narration: { estimated?: boolean; srt?: string; suspects?: { chapter_id: string; matchRate: number }[]; chapters?: { chapter_id: string; media: MediaRef | null; duration: number }[] };
  renders: Record<string, MediaRef>;
  thumbnails: MediaRef[];
  publishPlan: { posts?: { target: string; contentId: string; publishAt: string }[] } & Record<string, unknown>;
  approvals: Record<string, { at: string; by: string; note: string | null }>;
  report: Report | null;
  cost: { amounts: Record<string, number>; unpricedRows: number; calls: number; limit: number; currency: string };
  assetsApproved: boolean;
  jobs: { id: string; step: string; shotId: string | null; status: string; attempts: number; progress: string | null; error: string | null; createdAt: string; finishedAt: string | null }[];
  revisions: { id: string; step: string; reason: string | null; by: string; createdAt: string }[];
}

export interface ProfileInfo {
  id: string;
  label: string;
  help: string;
  minutes: { min: number; max: number; default: number };
  targets: string[];
  defaultTargets: string[];
}

export interface TargetInfo {
  id: string;
  label: string;
  platform: string;
  width: number;
  height: number;
  notes: string[];
}

export const TARGET_LABEL: Record<string, string> = {
  youtube_long: "YouTube 長尺",
  youtube_shorts: "YouTube ショート",
  tiktok: "TikTok",
  ig_reels: "Instagram リール",
};
