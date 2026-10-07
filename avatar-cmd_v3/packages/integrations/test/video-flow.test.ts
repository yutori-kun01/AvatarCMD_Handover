// 動画パイプラインの結合テスト（実 DB + 外部 API はモック）: ネタ → 承認A → 台本 → 承認B → ナレーション → 絵コンテ → 承認C → 本番画像 → 書き出し → 承認D → 予約投稿
// 設定を一時的に書き換えるため AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI で有効。本番 DB では実行しないこと）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { mockFetch } from "./helpers";

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarId = "";
let ytAccount = "";
let ttAccount = "";
const TOUCHED = ["openai_api_key", "anthropic_api_key", "gemini_api_key", "jev_api_key", "video_images", "video_limits", "video_fish_api_key", "video_measure_url", "worker_heartbeat", "image_provider"];
let saved: { key: string; value: string; secret: boolean }[] = [];
const env = { typesafe: process.env.TYPESAFE_API_KEY, fish: process.env.FISH_AUDIO_API_KEY, measure: process.env.VIDEO_MEASURE_URL, media: process.env.MEDIA_DIR, retry: process.env.VIDEO_RETRY_BASE_MS };

// 1x1 PNG
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function openaiText(text: string) {
  return { id: "resp_1", object: "response", model: "gpt-5", output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } };
}

const shot = (i: number, chapter: string, extra: Record<string, unknown> = {}) => ({
  shot_id: `s00${i}`,
  chapter_id: chapter,
  narration: `カット${i}のセリフです。調べてみると意外なことが分かりました。`,
  visual: { description: `場面${i}`, composition: "キャラ右寄り", character: i === 1, expression: "考え中", style: "illustration", realistic: false },
  motion_type: "pseudo",
  motion_note: "",
  short_candidate: { is_candidate: i <= 3, hook_rank: i <= 3 ? i : 0, note: "" },
  subtitle_emphasis: [],
  bgm_mood: "緊張",
  checks: ["画面内に文字なし"],
  ...extra,
});

const SCRIPT = {
  script: "冒頭のフックです。\n[[考察：人間が追記]]\n締めです。",
  critique: ["冒頭をもっと強く"],
  title_candidates: ["タイトル1", "タイトル2", "タイトル3", "タイトル4", "タイトル5"],
  format: "深掘り回",
  target_minutes: 1,
  sources: [{ label: "公式発表", url: "https://example.com/source" }],
  chapters: [
    { chapter_id: "ch01", title: "導入" },
    { chapter_id: "ch02", title: "本題" },
  ],
  shots: [shot(1, "ch01"), shot(2, "ch01"), shot(3, "ch02"), shot(4, "ch02")],
};

let qcVerdict: "pass" | "retry" = "pass";

function routes() {
  return mockFetch([
    [
      "POST",
      /api\.openai\.com\/v1\/responses$/,
      (c) => {
        const name = c.json?.text?.format?.name;
        if (name === "topics") return { json: openaiText(JSON.stringify({ topics: [{ title: "謎の電波塔", angle: "地元の記録から", sources: [{ label: "市の公式記録", url: "https://example.com/record" }] }] })) };
        if (name === "script") return { json: openaiText(JSON.stringify(SCRIPT)) };
        if (name === "video_qc") return { json: openaiText(JSON.stringify({ verdict: qcVerdict, reason: qcVerdict === "pass" ? "other" : "text_found", confidence: 0.9, note: qcVerdict === "pass" ? "" : "看板の文字を消す" })) };
        return { status: 400, json: { error: { message: `unexpected ${name}` } } };
      },
    ],
    ["POST", /api\.openai\.com\/v1\/images\/(generations|edits)$/, { data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 10, output_tokens: 100 } }],
    // 一次情報 URL の確認
    ["HEAD", /example\.com/, { }],
    ["GET", /example\.com/, { }],
  ]);
}

async function waitJobs(episodeId: string, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const n = await prisma.videoJob.count({ where: { episodeId, status: { in: ["queued", "running"] } } });
    if (!n) return;
    if (Date.now() > until) throw new Error("ジョブが終わりませんでした");
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  if (!hasDb) return;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.FISH_AUDIO_API_KEY;
  delete process.env.VIDEO_MEASURE_URL;
  process.env.MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "video-flow-"));
  process.env.VIDEO_RETRY_BASE_MS = "1";
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  saved = await prisma.appSetting.findMany({ where: { key: { in: TOUCHED } }, select: { key: true, value: true, secret: true } });
  await prisma.appSetting.deleteMany({ where: { key: { in: TOUCHED } } });
  const tag = Date.now().toString(36);
  userId = (await prisma.user.create({ data: { email: `video-test-${tag}@example.com`, name: "t" } })).id;
  avatarId = (await prisma.avatar.create({ data: { userId, name: `調べる人-${tag}`, role: "都市伝説の語り手", communication: { tone: "落ち着いた一人称" } } })).id;
  ytAccount = (await svc.saveConnectedAccount(avatarId, "youtube", { accountId: `yt${tag}`, accountName: "ch", credentials: { accessToken: "AT", refreshToken: "RT", expiresAt: new Date(Date.now() + 86400_000).toISOString() } })).id;
  ttAccount = (await svc.saveConnectedAccount(avatarId, "tiktok", { accountId: `tt${tag}`, accountName: "@me", credentials: { accessToken: "AT", refreshToken: "RT", expiresAt: new Date(Date.now() + 86400_000).toISOString() } })).id;
  await svc.setSetting("openai_api_key", "sk-test");
  await svc.saveVideoSettings({ images: { storyboard: { provider: "openai", model: "", quality: "low" }, final: { provider: "openai", model: "", quality: "high", compare: false }, thumbnail: { provider: "openai", model: "" } } });
});

after(async () => {
  if (!hasDb) return;
  await prisma.content.deleteMany({ where: { avatarId } });
  await prisma.snsAccount.deleteMany({ where: { avatarId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: [...TOUCHED, `video_assets_${avatarId}`] } } });
  for (const s of saved) await prisma.appSetting.create({ data: s });
  await prisma.avatar.deleteMany({ where: { id: avatarId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.decisionEvent.deleteMany({ where: { avatarId } });
  for (const [k, v] of Object.entries({ TYPESAFE_API_KEY: env.typesafe, FISH_AUDIO_API_KEY: env.fish, VIDEO_MEASURE_URL: env.measure, MEDIA_DIR: env.media, VIDEO_RETRY_BASE_MS: env.retry })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("動画パイプライン: 承認 A〜D を通して予約投稿まで進み、承認なしには進まない", opts, async () => {
  const m = routes();
  try {
    // 作成 → ネタ候補（10 件まで・一次情報 URL の確認つき）
    let ep = await svc.createEpisode({ avatarId, profile: "long_with_clips", targets: ["youtube_long", "tiktok"], theme: "地元の都市伝説", key: "tower", targetMinutes: 1 });
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    assert.equal(ep.stage, "approve_topic", JSON.stringify(ep.jobs));
    assert.equal(ep.topics[0].title, "謎の電波塔");
    assert.equal(ep.topics[0].sources[0].ok, true);
    // 承認 A の前に台本の承認はできない
    await assert.rejects(svc.approveScript(ep.id), /今の工程/);

    // 承認 A → 台本（自己批評つきで 2 回生成）
    await svc.approveTopic(ep.id, { index: 0 });
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    assert.equal(ep.stage, "approve_script");
    assert.equal(ep.shotlist.shots.length, 4);
    assert.equal(ep.format, "深掘り回");
    assert.equal(m.calls.filter((c) => c.json?.text?.format?.name === "script").length, 2, "章立て→本文→自己批評→修正の 2 回");

    // 承認 B: 考察が未記入・固定アセットが未確定なら承認できない
    await assert.rejects(svc.approveScript(ep.id), /考察パートが未記入[\s\S]*固定アセット/);
    await svc.updateScript(ep.id, { script: "冒頭のフックです。\n私はこの話を、地元の古い記録と照らすと別の見方ができると考えています。\n締めです。" });
    await svc.saveVideoAssets(avatarId, { characterText: "黒髪ボブの調査員", styleText: "落ち着いた水彩", approve: true });
    await svc.approveScript(ep.id);
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    // 音声サービス未設定 → 文字数から尺を見積もって絵コンテへ。全カットの絵コンテが検品を通ったら承認 C
    assert.equal(ep.narration.estimated, true);
    assert.match(ep.narration.srt ?? "", /^1\n00:00:00,000 --> /);
    assert.equal(ep.stage, "approve_storyboard", JSON.stringify(ep.jobs.filter((j) => j.status === "failed")));
    assert.ok(ep.shotlist.shots.every((s) => s.assets.storyboard && s.qc.result === "pass" && s.qc.engine === "claude"));
    assert.ok(ep.shotlist.shots.every((s) => s.status === "draft"), "絵コンテは人の承認まで storyboard_ok にしない");

    // 承認 C: 差し戻しは理由が必須。差し戻したカットだけ作り直す
    await assert.rejects(svc.reviewStoryboard(ep.id, [{ shotId: "s002", approve: false }]), /理由/);
    const before2 = ep.shotlist.shots.find((s) => s.shot_id === "s002")!.assets.storyboard;
    const before1 = ep.shotlist.shots.find((s) => s.shot_id === "s001")!.assets.storyboard;
    await svc.reviewStoryboard(ep.id, [
      { shotId: "s001", approve: true },
      { shotId: "s002", approve: false, note: "背景を夜にする" },
      { shotId: "s003", approve: true },
      { shotId: "s004", approve: true },
    ]);
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    const s2 = ep.shotlist.shots.find((s) => s.shot_id === "s002")!;
    assert.notEqual(s2.assets.storyboard, before2);
    assert.equal(s2.storyboard_review, "pending");
    assert.equal(ep.shotlist.shots.find((s) => s.shot_id === "s001")!.assets.storyboard, before1, "承認済みのカットは作り直さない");
    const redo = m.calls.filter((c) => /images\/generations$/.test(c.url) && /背景を夜にする/.test(c.json?.prompt ?? ""));
    assert.equal(redo.length, 1, "差し戻しの理由をプロンプトに入れる");
    assert.equal(ep.stage, "approve_storyboard");

    // 残りを承認 → 本番画像（承認済みの絵コンテを参照に 2048×2048）→ pseudo だけなので書き出しへ
    await svc.reviewStoryboard(ep.id, [{ shotId: "s002", approve: true }]);
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    assert.equal(ep.stage, "render", JSON.stringify(ep.jobs.filter((j) => j.status === "failed")));
    assert.ok(ep.shotlist.shots.every((s) => s.status === "video_ok" && s.assets.final_image && s.pseudo_motion));
    assert.ok(m.calls.some((c) => /images\/edits$/.test(c.url)), "本番画像は絵コンテを参照画像に渡す");
    assert.equal(ep.thumbnails.length, 3);

    // 書き出しの情報（外部の書き出しサーバー用）
    const manifest = await svc.renderManifest(ep.id);
    assert.equal(manifest.shots.length, 4);
    assert.ok(manifest.subtitles.cues.length >= 4);
    assert.equal(manifest.targets.find((t) => t.id === "tiktok")!.burnCaptions, true);

    // 書き出した動画を登録 → 承認 D へ
    const video = await svc.saveMedia(new Uint8Array([0, 0, 0, 24]), "long.mp4", "video/mp4");
    const vertical = await svc.saveMedia(new Uint8Array([0, 0, 0, 24]), "short.mp4", "video/mp4");
    await svc.setRender(ep.id, "youtube_long", video);
    ep = await svc.getEpisodeView(ep.id);
    assert.equal(ep.stage, "render", "全出力先がそろうまで承認 D にしない");
    await svc.setRender(ep.id, "tiktok", vertical);
    ep = await svc.getEpisodeView(ep.id);
    assert.equal(ep.stage, "approve_publish");
    assert.ok(ep.shotlist.shots.every((s) => s.status === "rendered"));

    // 承認 D: TikTok は投稿設定の同意が必須、公開日時は未来
    const publishAt = new Date(Date.now() + 2 * 86400_000).toISOString();
    const plan = {
      title: "謎の電波塔の正体",
      description: await svc.descriptionDraft(ep.id),
      thumbnail: ep.thumbnails[1].name,
      madeForKids: false,
      targets: {
        youtube_long: { accountId: ytAccount, publishAt },
        tiktok: { accountId: ttAccount, publishAt, text: "続きは YouTube で", tiktok: { privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: true, disableStitch: true, consent: false } },
      },
    };
    await assert.rejects(svc.approvePublish(ep.id, plan), /同意/);
    await assert.rejects(svc.approvePublish(ep.id, { ...plan, targets: { ...plan.targets, youtube_long: { accountId: ytAccount, publishAt: new Date(Date.now() - 1000).toISOString() } } }), /5 分以上先/);
    assert.equal(await prisma.content.count({ where: { avatarId } }), 0, "検証に失敗したら一部だけ予約しない");
    plan.targets.tiktok.tiktok.consent = true;
    ep = await svc.approvePublish(ep.id, plan);
    assert.equal(ep.stage, "scheduled");
    assert.equal(ep.status, "done");

    const posts = await prisma.content.findMany({ where: { avatarId }, include: { scheduledPost: true } });
    assert.equal(posts.length, 2);
    const yt = posts.find((p) => p.platform === "youtube")!;
    const ytMeta = yt.metadata as any;
    assert.equal(ytMeta.options.publishAt, publishAt);
    assert.equal(ytMeta.options.madeForKids, "false");
    assert.ok(ytMeta.options.captionsSrt.startsWith("1\n"));
    assert.equal(ytMeta.media.length, 2, "長尺はサムネイルも添付");
    assert.ok(yt.scheduledPost!.scheduledAt.getTime() <= Date.now(), "YouTube は今すぐ非公開でアップロードして予約公開");
    const tt = posts.find((p) => p.platform === "tiktok")!;
    assert.equal((tt.metadata as any).options.aiGenerated, "true");
    assert.equal((tt.metadata as any).options.privacyLevel, "SELF_ONLY");
    assert.equal(tt.scheduledPost!.scheduledAt.toISOString(), publishAt, "TikTok は API に予約が無いので指定日時に送る");

    // 費用はエピソードに紐づいて台帳に残る
    const ledger = await prisma.usageLedger.count({ where: { subjectId: ep.id, context: "video" } });
    assert.ok(ledger >= 10);
    const revisions = await prisma.videoShotlistRevision.count({ where: { episodeId: ep.id } });
    assert.ok(revisions >= 10, "カット指示書の更新履歴");
  } finally {
    m.restore();
  }
});

test("動画パイプライン: 検品で作り直しが上限に達したらカットを止めて人に報告する", opts, async () => {
  const m = routes();
  try {
    await svc.saveVideoSettings({ limits: { maxRetries: 1 } });
    let ep = await svc.createEpisode({ avatarId, profile: "ad", targets: ["tiktok"], theme: "新商品の PR: 折りたたみ傘", targetMinutes: 0.5 });
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    assert.equal(ep.stage, "approve_script", "広告はネタ候補を使わない");
    await svc.approveScript(ep.id);
    qcVerdict = "retry";
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    const s = ep.shotlist.shots[0];
    assert.equal(s.qc.result, "retry");
    assert.equal(s.qc.retries, 1);
    assert.ok(ep.report && /上限/.test(ep.report.what), JSON.stringify(ep.report));
    assert.ok(m.calls.some((c) => /看板の文字を消す/.test(c.json?.prompt ?? "")), "検品の指摘をプロンプトに反映して作り直す");
    // 人が今の画像で合格にできる
    ep = await svc.resolveShot(ep.id, s.shot_id, { action: "accept", note: "許容範囲" });
    assert.equal(ep.shotlist.shots[0].qc.engine, "human");
  } finally {
    qcVerdict = "pass";
    m.restore();
  }
});

test("動画パイプライン: 1 本あたりの費用上限を超えたら全工程を一時停止する", opts, async () => {
  const m = routes();
  try {
    await prisma.priceEntry.create({ data: { provider: "openai", model: "*", unit: "request", price: 100, per: 1, currency: "USD", effectiveFrom: new Date(0), checkedAt: new Date(), note: "video-flow test" } });
    await svc.saveVideoSettings({ limits: { episodeBudget: 1, monthlyBudget: 1_000_000, maxRetries: 3 } });
    let ep = await svc.createEpisode({ avatarId, profile: "vertical_only", theme: "雑学", targetMinutes: 0.5 });
    await waitJobs(ep.id);
    // ネタ候補の生成で費用が発生 → 承認後の台本ジョブの開始前に止まる
    await svc.approveTopic(ep.id, { index: 0 });
    await waitJobs(ep.id);
    ep = await svc.getEpisodeView(ep.id);
    assert.equal(ep.status, "paused");
    assert.match(ep.report?.what ?? "", /費用上限/);
    await assert.rejects(svc.setEpisodeStatus(ep.id, "resume"), /上限/);
  } finally {
    await prisma.priceEntry.deleteMany({ where: { note: "video-flow test" } });
    await svc.saveVideoSettings({ limits: { episodeBudget: 60, monthlyBudget: 900 } });
    m.restore();
  }
});
