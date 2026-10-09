// 動画化（Kling i2v）: 認証トークン・依頼 → 待つ → ダウンロード、と工程への組み込み（DB のテストは AVATAR_CMD_DB_TESTS=1 のときだけ）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { mockFetch } from "./helpers";
import { klingToken, runI2v, DEFAULT_KLING, type KlingConfig } from "../src/service/video-i2v";

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };
const cfg: KlingConfig = { ...DEFAULT_KLING, baseUrl: "https://kling.test", accessKey: "AK", secretKey: "SK" };

/** Kling の模擬: 1 回目の確認は processing、2 回目で succeed */
function klingRoutes() {
  let polls = 0;
  return mockFetch([
    ["POST", /^https:\/\/kling\.test\/v1\/videos\/image2video$/, { code: 0, message: "SUCCEED", data: { task_id: "task-1", task_status: "submitted" } }],
    [
      "GET",
      /^https:\/\/kling\.test\/v1\/videos\/image2video\/task-1$/,
      () => ({ json: polls++ === 0 ? { code: 0, data: { task_id: "task-1", task_status: "processing" } } : { code: 0, data: { task_id: "task-1", task_status: "succeed", task_result: { videos: [{ id: "v1", url: "https://cdn.kling.test/v1.mp4", duration: "5.1" }] } } } }),
    ],
    ["GET", /^https:\/\/cdn\.kling\.test\/v1\.mp4$/, () => ({ text: "MP4DATA" })],
  ]);
}

test("Kling: 認証トークンは HS256 の JWT（iss = Access Key、30 分有効）", () => {
  const t = klingToken("AK", "SK", 1_700_000_000_000);
  const [h, b, sig] = t.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(b, "base64url").toString()), { iss: "AK", exp: 1_700_001_800, nbf: 1_699_999_995 });
  assert.equal(sig, createHmac("sha256", "SK").update(`${h}.${b}`).digest("base64url"));
});

test("Kling: 依頼 → できるまで待つ → 動画をダウンロード", async () => {
  const m = klingRoutes();
  try {
    const r = await runI2v(cfg, { image: new Uint8Array([1, 2, 3]), prompt: "ゆっくり振り向く" }, { pollMs: 1 });
    assert.equal(r.taskId, "task-1");
    assert.equal(Buffer.from(r.bytes).toString(), "MP4DATA");
    assert.equal(r.duration, 5.1);
    const create = m.calls[0];
    assert.match(create.headers.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(create.json.model_name, "kling-v3");
    assert.equal(create.json.mode, "pro");
    assert.equal(create.json.duration, "5");
    assert.equal(create.json.image, Buffer.from([1, 2, 3]).toString("base64"));
    assert.equal(create.json.prompt, "ゆっくり振り向く");
  } finally {
    m.restore();
  }
});

test("Kling: 認証エラー・失敗は理由の分かるエラーにする", async () => {
  let m = mockFetch([["POST", /image2video$/, () => ({ status: 401, json: { code: 1002, message: "Authorization is invalid" } })]]);
  try {
    await assert.rejects(runI2v(cfg, { image: new Uint8Array(), prompt: "x" }, { pollMs: 1 }), /認証に失敗/);
  } finally {
    m.restore();
  }
  m = mockFetch([
    ["POST", /image2video$/, { code: 0, data: { task_id: "t2" } }],
    ["GET", /image2video\/t2$/, { code: 0, data: { task_status: "failed", task_status_msg: "image is invalid" } }],
  ]);
  try {
    await assert.rejects(runI2v(cfg, { image: new Uint8Array(), prompt: "x" }, { pollMs: 1 }), /image is invalid/);
  } finally {
    m.restore();
  }
});

// --- 工程への組み込み（実 DB） ----------------------------------------------------------

let svc: typeof import("../src/server");
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
const TOUCHED = ["video_kling", "video_kling_access_key", "video_kling_secret_key", "worker_heartbeat"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const envMedia = process.env.MEDIA_DIR;

before(async () => {
  if (!hasDb) return;
  process.env.MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "video-i2v-"));
  process.env.KLING_POLL_MS = "1";
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `i2v-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `i2v-${tag}`, role: "語り手" } })).id;
});

after(async () => {
  if (!hasDb) return;
  await prisma.videoEpisode.deleteMany({ where: { avatarId } });
  await prisma.avatar.deleteMany({ where: { id: avatarId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  if (envMedia === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = envMedia;
});

test("動画化: Kling で i2v のカットを動画にし、そろったら書き出しへ進む", opts, async () => {
  const img = await svc.saveMedia(new Uint8Array([137, 80, 78, 71]), "final.png", "image/png");
  const base = (id: string, motion: string, status: string) => ({
    shot_id: id,
    chapter_id: "ch01",
    narration: "セリフ",
    visual: { description: `場面 ${id}`, composition: "", character: true, expression: "驚き", style: "illustration", realistic: false },
    motion_type: motion,
    motion_note: "ゆっくり振り向く",
    status,
    storyboard_review: "approved",
    assets: { storyboard: img.name, final_image: img.name, video: null },
  });
  const ep = await prisma.videoEpisode.create({
    data: {
      avatarId,
      episodeKey: `i2v-${Date.now().toString(36)}`,
      stage: "video",
      targets: ["tiktok"],
      shotlist: { chapters: [{ chapter_id: "ch01", title: "導入" }], shots: [base("s001", "i2v", "final_ok"), base("s002", "pseudo", "video_ok")] },
    },
  });
  // キー未設定では始められない
  await assert.rejects(svc.startI2v(ep.id), /Access Key/);
  await svc.saveKlingSettings({ accessKey: "AK", secretKey: "SK", baseUrl: "https://kling.test" });
  const m = klingRoutes();
  try {
    await svc.startI2v(ep.id);
    const until = Date.now() + 15_000;
    while ((await prisma.videoJob.count({ where: { episodeId: ep.id, step: "i2v", status: { in: ["queued", "running"] } } })) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    const job = await prisma.videoJob.findFirstOrThrow({ where: { episodeId: ep.id, step: "i2v" } });
    assert.equal(job.status, "done", job.error ?? "");
    const view = await svc.getEpisodeView(ep.id);
    const s1 = view.shotlist.shots.find((s) => s.shot_id === "s001")!;
    assert.equal(s1.status, "video_ok");
    assert.ok(s1.assets.video?.endsWith(".mp4"));
    assert.equal((await svc.readMedia(s1.assets.video!)).toString(), "MP4DATA");
    assert.equal(s1.qc.engine, "kling");
    assert.equal(view.stage, "render");
    // 送ったプロンプトに動きの指示が入っている
    assert.match(m.calls.find((c) => c.method === "POST" && c.url.includes("kling"))!.json.prompt, /ゆっくり振り向く/);
    // 書き出しへ進むとサムネイルのジョブが入る（画像生成のキーが無いので失敗する）。終わるのを待ってから片付ける
    assert.ok(await prisma.videoJob.count({ where: { episodeId: ep.id, step: "thumbnails" } }));
    while ((await prisma.videoJob.count({ where: { episodeId: ep.id, status: { in: ["queued", "running"] } } })) && Date.now() < until + 15_000) await new Promise((r) => setTimeout(r, 50));
  } finally {
    m.restore();
  }
});
