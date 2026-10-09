// ================================================
// 動画パイプライン — 動画化（i2v: Kling の image-to-video）
// ================================================
// 承認済みの本番画像（1 カット）を Kling に渡して数秒の動画にする。音声は付けない（ナレーション・BGM は書き出しで合わせる）。
//   POST {base}/v1/videos/image2video        { model_name, image(base64), prompt, negative_prompt, mode, duration } → data.task_id
//   GET  {base}/v1/videos/image2video/{id}   → data.task_status（submitted / processing / succeed / failed）, data.task_result.videos[0].url
// 認証は Access Key / Secret Key から作る JWT（HS256、iss = Access Key、有効 30 分）を Bearer で送る。
// 接続先・モデル名は Kling 側の変更に合わせて 設定 > 動画 で変えられる（既定: api-singapore.klingai.com / kling-v3 / pro / 5 秒）。
// 自動で始める（auto）は既定でオフ。オフのときは画面の「Kling で動画化」から始める。どちらでも、できた動画は人が見て差し替えられる。

import { createHmac } from "crypto";
import { ConfigError } from "../http";
import { getSetting, mask, setSetting, SETTING_KEYS } from "./store";
import { recordUsage } from "./usage";

const KEY = "video_kling";

export interface KlingSettings {
  baseUrl: string;
  model: string;
  /** std（標準）/ pro（高品質） */
  mode: "std" | "pro";
  /** 秒数（5 / 10） */
  duration: 5 | 10;
  /** 本番画像がそろって動画化の工程に入ったら、i2v のカットを自動で Kling に回す */
  auto: boolean;
  negativePrompt: string;
}

export const DEFAULT_KLING: KlingSettings = {
  baseUrl: "https://api-singapore.klingai.com",
  model: "kling-v3",
  mode: "pro",
  duration: 5,
  auto: false,
  negativePrompt: "文字, 字幕, ロゴ, 透かし, 顔の崩れ, 指の崩れ, 急なカメラの動き, ちらつき",
};

export interface KlingConfig extends KlingSettings {
  accessKey: string;
  secretKey: string;
}

export async function getKlingSettings(): Promise<KlingSettings> {
  try {
    return { ...DEFAULT_KLING, ...JSON.parse((await getSetting(KEY)) ?? "{}") };
  } catch {
    return DEFAULT_KLING;
  }
}

/** キーがそろっていれば接続情報、無ければ null */
export async function klingConfig(): Promise<KlingConfig | null> {
  const accessKey = (await getSetting(SETTING_KEYS.videoKlingAccessKey)) || process.env.KLING_ACCESS_KEY || "";
  const secretKey = (await getSetting(SETTING_KEYS.videoKlingSecretKey)) || process.env.KLING_SECRET_KEY || "";
  if (!accessKey || !secretKey) return null;
  return { ...(await getKlingSettings()), accessKey, secretKey };
}

export async function describeKling() {
  const [s, ak, sk] = await Promise.all([getKlingSettings(), getSetting(SETTING_KEYS.videoKlingAccessKey), getSetting(SETTING_KEYS.videoKlingSecretKey)]);
  return { ...s, accessKey: ak ? mask(ak) : "", secretKeySet: !!sk, fromEnv: !ak && !!process.env.KLING_ACCESS_KEY, defaults: DEFAULT_KLING };
}

export interface KlingInput extends Partial<KlingSettings> {
  /** 空欄 = 変更しない、"-" = 削除 */
  accessKey?: string;
  secretKey?: string;
}

export async function saveKlingSettings(input: KlingInput): Promise<void> {
  const cur = await getKlingSettings();
  const baseUrl = (input.baseUrl ?? cur.baseUrl).trim().replace(/\/+$/, "") || DEFAULT_KLING.baseUrl;
  if (!/^https:\/\/[^/]+$/.test(baseUrl)) throw new ConfigError("Kling の接続先は https://ホスト名 の形で入力してください（例: https://api-singapore.klingai.com）");
  const model = (input.model ?? cur.model).trim() || DEFAULT_KLING.model;
  if (!/^[a-z0-9._\-]+$/i.test(model)) throw new ConfigError(`Kling のモデル名が不正です: ${model}`);
  const next: KlingSettings = {
    baseUrl,
    model,
    mode: (input.mode ?? cur.mode) === "std" ? "std" : "pro",
    duration: Number(input.duration ?? cur.duration) === 10 ? 10 : 5,
    auto: input.auto ?? cur.auto,
    negativePrompt: String(input.negativePrompt ?? cur.negativePrompt).trim().slice(0, 500),
  };
  await setSetting(KEY, JSON.stringify(next));
  const ak = input.accessKey?.trim();
  if (ak) await setSetting(SETTING_KEYS.videoKlingAccessKey, ak === "-" ? null : ak);
  const sk = input.secretKey?.trim();
  if (sk) await setSetting(SETTING_KEYS.videoKlingSecretKey, sk === "-" ? null : sk);
}

// --- API -------------------------------------------------------------------------------

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** Kling の認証トークン（HS256 の JWT。iss = Access Key、exp = 30 分後、nbf = 5 秒前） */
export function klingToken(accessKey: string, secretKey: string, now = Date.now()): string {
  const sec = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: sec + 1800, nbf: sec - 5 }));
  const sig = b64url(createHmac("sha256", secretKey).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

async function call(cfg: KlingConfig, method: "GET" | "POST", path: string, json?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${klingToken(cfg.accessKey, cfg.secretKey)}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    throw new Error(`Kling に接続できません（${new URL(cfg.baseUrl).host}${cause ? `: ${cause}` : ""}）。接続先の設定を確認してください`);
  }
  const text = await res.text();
  let d: any = {};
  try {
    d = JSON.parse(text);
  } catch {
    /* JSON 以外 */
  }
  // Kling は HTTP 200 でも code が 0 以外のことがある
  if (!res.ok || (typeof d.code === "number" && d.code !== 0)) {
    const msg = d.message || d.msg || text.slice(0, 200) || `HTTP ${res.status}`;
    if (res.status === 401 || d.code === 1000 || d.code === 1001 || d.code === 1002 || d.code === 1003 || d.code === 1004) throw new ConfigError(`Kling: 認証に失敗しました（${msg}）。Access Key / Secret Key を確認してください`);
    if (d.code === 1101 || d.code === 1102 || /balance|quota|insufficient/i.test(msg)) throw new ConfigError(`Kling: 残高・リソースパックが不足しています（${msg}）`);
    if (d.code === 1301 || /risk|safety|sensitive|prohibit/i.test(msg)) throw new Error(`Kling: 安全フィルタで生成を断りました（${msg}）`);
    const err = new Error(`Kling: ${msg}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return d.data ?? {};
}

export interface I2vRequest {
  /** 本番画像（png / jpg） */
  image: Uint8Array;
  prompt: string;
}

/** 動画化の依頼。Kling のタスク ID を返す */
export async function createI2vTask(cfg: KlingConfig, req: I2vRequest): Promise<string> {
  const data = await call(cfg, "POST", "/v1/videos/image2video", {
    model_name: cfg.model,
    image: Buffer.from(req.image).toString("base64"),
    prompt: req.prompt.slice(0, 2500),
    negative_prompt: cfg.negativePrompt || undefined,
    mode: cfg.mode,
    duration: String(cfg.duration),
  });
  const id = data.task_id ?? data.id;
  if (!id) throw new Error("Kling: タスク ID が返りませんでした");
  return String(id);
}

export type I2vStatus = { state: "running"; message?: string } | { state: "done"; url: string; duration: number | null } | { state: "failed"; message: string };

export async function getI2vTask(cfg: KlingConfig, taskId: string): Promise<I2vStatus> {
  const data = await call(cfg, "GET", `/v1/videos/image2video/${encodeURIComponent(taskId)}`);
  const status = String(data.task_status ?? data.status ?? "").toLowerCase();
  if (status === "succeed" || status === "succeeded" || status === "success") {
    const v = data.task_result?.videos?.[0];
    if (!v?.url) return { state: "failed", message: "動画の URL が返りませんでした" };
    return { state: "done", url: String(v.url), duration: v.duration ? Number(v.duration) : null };
  }
  if (status === "failed" || status === "fail") return { state: "failed", message: String(data.task_status_msg ?? "生成に失敗しました") };
  return { state: "running", message: status || undefined };
}

/** 依頼してからできあがるまで待つ。poll は待ち時間（テストでは短く） */
export async function runI2v(
  cfg: KlingConfig,
  req: I2vRequest,
  opts: { pollMs?: number; timeoutMs?: number; onTask?: (taskId: string) => unknown; onProgress?: (text: string) => unknown; taskId?: string } = {}
): Promise<{ taskId: string; bytes: Uint8Array; duration: number | null }> {
  const pollMs = opts.pollMs ?? Number(process.env.KLING_POLL_MS || 10_000);
  const until = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
  let taskId = opts.taskId;
  if (!taskId) {
    try {
      taskId = await createI2vTask(cfg, req);
    } catch (e) {
      await recordUsage({ provider: "kling", model: cfg.model, purpose: "video_i2v", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    await opts.onTask?.(taskId);
  }
  for (;;) {
    const s = await getI2vTask(cfg, taskId);
    if (s.state === "done") {
      const res = await fetch(s.url);
      if (!res.ok) throw new Error(`Kling: できた動画をダウンロードできませんでした（${res.status}）`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      // 1 本 = 1 回（requests）、秒数は reads に残す。設定 > API コスト で kling の単価を登録すると集計される
      await recordUsage({ provider: "kling", model: `${cfg.model}-${cfg.mode}`, purpose: "video_i2v", requests: 1, reads: s.duration ?? cfg.duration });
      return { taskId, bytes, duration: s.duration };
    }
    if (s.state === "failed") {
      await recordUsage({ provider: "kling", model: cfg.model, purpose: "video_i2v", error: s.message });
      throw new Error(`Kling: ${s.message}`);
    }
    if (Date.now() > until) throw new Error(`Kling: ${Math.round((opts.timeoutMs ?? 20 * 60_000) / 60_000)} 分待っても動画ができませんでした（タスク ${taskId}）`);
    await opts.onProgress?.(`Kling で生成中（${s.message ?? "processing"}）`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
