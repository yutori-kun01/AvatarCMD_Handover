// 動画パイプラインの純粋なルール（カット指示書・検品の判定・字幕・読み辞書・出力先）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignShots,
  assignPseudoMotions,
  buildCues,
  chapterTimestamps,
  formatRotationIssue,
  needsDisclosure,
  normalizeShotlist,
  patchShot,
  proposePseudoFallback,
  shotImagePrompt,
  splitSubtitle,
  toSrt,
  validateShotlist,
} from "../src/service/video-shotlist";
import { metricFlags, qcNextAction, reviewNextAction } from "../src/service/video-qc";
import { applyReadingDict, scriptMatchRate } from "../src/service/video-tts";
import { normalizeTargets, VIDEO_PROFILES, VIDEO_TARGETS } from "../src/service/video-profiles";
import { normalizeLimits, DEFAULT_VIDEO_LIMITS } from "../src/service/video-config";
import { parseTopics } from "../src/service/video-jobs";
import { buildDescription } from "../src/service/video-pipeline";
import { textSimilarity } from "../src/service/video-episode";

const rawShot = (i: number, extra: Record<string, unknown> = {}) => ({
  shot_id: `s00${i}`,
  chapter_id: "ch01",
  narration: `これはカット${i}のセリフです。`,
  visual: { description: `場面${i}`, composition: "中央", character: i % 2 === 0, expression: "考え中", style: "illustration", realistic: false },
  motion_type: "pseudo",
  ...extra,
});

test("カット指示書の正規化: 既定値を入れ、章とカットの対応を作り直し、重複 ID を振り直す", () => {
  const sl = normalizeShotlist(
    {
      title_candidates: ["a", "b", "c"],
      format: "深掘り回",
      sources: [{ label: "x", url: "https://example.com" }, { label: "bad", url: "javascript:alert(1)" }],
      chapters: [{ chapter_id: "ch01", title: "導入", shot_ids: ["zzz"] }, { chapter_id: "ch02", title: "本題" }],
      shots: [rawShot(1), rawShot(2, { chapter_id: "ch02" }), rawShot(3, { shot_id: "s001", chapter_id: "nope", motion_type: "weird", visual: { style: "photo" } })],
    },
    "2026-10-09_test"
  );
  assert.equal(sl.episode_id, "2026-10-09_test");
  assert.equal(sl.sources.length, 1);
  assert.deepEqual(sl.chapters[0].shot_ids, ["s001", "s003x"]);
  assert.deepEqual(sl.chapters[1].shot_ids, ["s002"]);
  const s3 = sl.shots[2];
  assert.equal(s3.shot_id, "s003x");
  assert.equal(s3.chapter_id, "ch01");
  assert.equal(s3.motion_type, "pseudo");
  assert.equal(s3.visual.style, "illustration");
  assert.equal(s3.status, "draft");
  assert.equal(s3.storyboard_review, "pending");
  assert.deepEqual(s3.qc.retries, 0);
  assert.ok(sl.shots[1].checks.includes("顔が設定書と一致"));
  assert.ok(!sl.shots[0].checks.includes("顔が設定書と一致"));
  assert.ok(sl.shots[0].duration_sec >= 2);
});

test("カット指示書の検証: i2v の上限超過・ショート候補の数・空のセリフ", () => {
  const sl = normalizeShotlist({ shots: [rawShot(1, { motion_type: "i2v" }), rawShot(2, { motion_type: "i2v" }), rawShot(3, { narration: "" })], title_candidates: ["a"] }, "e");
  const r = validateShotlist(sl, { maxI2vShots: 1, shortCandidates: { min: 3, max: 5 } });
  assert.ok(r.errors.some((e) => /s003: セリフ/.test(e)));
  assert.ok(r.warnings.some((w) => /i2v.*上限 1/.test(w)));
  assert.ok(r.warnings.some((w) => /ショート候補が 0/.test(w)));
  assert.ok(r.warnings.some((w) => /出典/.test(w)));
  assert.deepEqual(proposePseudoFallback(sl, 1), ["s002"]);
});

test("回の型のローテーション: 3 本連続はエラー、直前と同じは警告", () => {
  assert.equal(formatRotationIssue("深掘り回", ["深掘り回", "深掘り回"])?.level, "error");
  assert.equal(formatRotationIssue("深掘り回", ["深掘り回", "体験談回"])?.level, "warning");
  assert.equal(formatRotationIssue("深掘り回", ["体験談回", "深掘り回"]), null);
  assert.equal(formatRotationIssue(null, ["深掘り回"]), null);
});

test("工程の担当フィールド: 担当外の更新と状態の飛び越しを拒否する", () => {
  const sl = normalizeShotlist({ shots: [rawShot(1)] }, "e");
  const s = sl.shots[0];
  assert.throws(() => patchShot(s, "narration", { narration: "書き換え" }), /担当外/);
  assert.throws(() => patchShot(s, "final", { status: "final_ok" }), /飛ばして/);
  const ok = patchShot(s, "storyboard", { assets: { ...s.assets, storyboard: "x.png" }, qc: { ...s.qc, result: "pass" } });
  assert.equal(ok.assets.storyboard, "x.png");
  assert.equal(ok.assets.final_image, null);
  assert.equal(s.assets.storyboard, null, "元のカットは変えない");
  const approved = patchShot(ok, "storyboard_review", { storyboard_review: "approved", status: "storyboard_ok" });
  assert.equal(approved.status, "storyboard_ok");
});

test("開示: 実写と見間違えるカットが 1 つでもあれば必要", () => {
  assert.equal(needsDisclosure(normalizeShotlist({ shots: [rawShot(1)] }, "e")), false);
  assert.equal(needsDisclosure(normalizeShotlist({ shots: [rawShot(1), rawShot(2, { visual: { description: "x", realistic: true } })] }, "e")), true);
});

test("タイムスタンプの割り当て: 台本の文字数でカットの開始・終了を決め、すき間を作らない", () => {
  const shots = [
    { shot_id: "a", narration: "あいうえおかきくけこ" },
    { shot_id: "b", narration: "さしすせそ" },
  ];
  const words = [
    { text: "あいうえお", start: 0, end: 1 },
    { text: "かきくけこ", start: 1, end: 2 },
    { text: "さしすせそ", start: 2.2, end: 3 },
  ];
  const t = alignShots(shots, words, 10);
  assert.equal(t[0].start, 10);
  assert.equal(t[0].end, t[1].start);
  assert.equal(t[1].start, 12.2);
  assert.equal(t[1].end, 13);
  assert.deepEqual(alignShots(shots, []), []);
});

test("字幕: 全角 16 文字 × 2 行まで、句読点で区切る。SRT とチャプター", () => {
  const pages = splitSubtitle("今日は、都市伝説として語られてきたある事件について、調べたことを順番にお話しします。最後に私の考えもお伝えします。");
  for (const p of pages) {
    assert.ok(p.length <= 2);
    for (const line of p) assert.ok(line.length <= 16, line);
  }
  assert.equal(pages.flat().join(""), "今日は、都市伝説として語られてきたある事件について、調べたことを順番にお話しします。最後に私の考えもお伝えします。");
  assert.deepEqual(splitSubtitle(""), []);
  const cues = buildCues([{ shot_id: "a", narration: "短いセリフ" }], [{ shot_id: "a", start: 1.5, end: 3 }]);
  const srt = toSrt(cues);
  assert.match(srt, /^1\n00:00:01,500 --> 00:00:03,000\n短いセリフ\n/);
  const sl = normalizeShotlist({ chapters: [{ chapter_id: "ch01", title: "導入" }, { chapter_id: "ch02", title: "本題" }], shots: [rawShot(1), rawShot(2, { chapter_id: "ch02" })] }, "e");
  assert.deepEqual(chapterTimestamps(sl, [{ shot_id: "s001", start: 0.4, end: 5 }, { shot_id: "s002", start: 65, end: 70 }]), ["0:00 導入", "1:05 本題"]);
});

test("擬似アニメ: 同じ動きを 3 カット以上連続させない", () => {
  const sl = normalizeShotlist({ shots: [1, 2, 3, 4, 5, 6].map((i) => rawShot(i, { pseudo_motion: "zoom_in" })) }, "e");
  const out = assignPseudoMotions(sl.shots).map((s) => s.pseudo_motion);
  for (let i = 2; i < out.length; i++) assert.ok(!(out[i] === out[i - 1] && out[i] === out[i - 2]), out.join(","));
});

test("画像プロンプト: 画風 → キャラ設定 → 内容・構図の順。キャラなしカットにはキャラ設定を入れない", () => {
  const sl = normalizeShotlist({ shots: [rawShot(1), rawShot(2)] }, "e");
  const withChar = shotImagePrompt(sl.shots[1], { style: "水彩", character: "黒髪ボブ" });
  assert.ok(withChar.indexOf("水彩") < withChar.indexOf("黒髪ボブ"));
  assert.ok(withChar.indexOf("黒髪ボブ") < withChar.indexOf("場面2"));
  assert.match(withChar, /中央 60%/);
  assert.doesNotMatch(shotImagePrompt(sl.shots[0], { style: "水彩", character: "黒髪ボブ" }), /黒髪ボブ/);
});

test("検品の判定後の処理（指示書 7-3）", () => {
  const o = { threshold: 0.85, retries: 0, maxRetries: 3 };
  assert.equal(qcNextAction({ result: "pass", confidence: 0.9 }, o), "advance");
  assert.equal(qcNextAction({ result: "pass", confidence: 0.6 }, o), "review");
  assert.equal(qcNextAction({ result: "retry", confidence: 0.9 }, o), "retry");
  assert.equal(qcNextAction({ result: "retry", confidence: 0.9 }, { ...o, retries: 3 }), "stop");
  assert.equal(qcNextAction({ result: "hold", confidence: 0.99 }, o), "review");
  assert.equal(qcNextAction({ result: "pass", confidence: null }, o), "review");
  assert.equal(reviewNextAction("pass", o), "advance");
  assert.equal(reviewNextAction("retry", { retries: 3, maxRetries: 3 }), "stop");
  assert.equal(reviewNextAction("hold", o), "human");
});

test("計測値の手がかり: 顔の一致度・文字・手指・構図", () => {
  const f = metricFlags({ face_similarity: 0.4, text_detected: ["ABC"], hand_anomalies: ["指が6本"], composition: { in_center_60: false } }, { faceThreshold: 0.6 });
  assert.equal(f.length, 4);
  assert.deepEqual(metricFlags(null, { faceThreshold: 0.6 }), []);
  assert.deepEqual(metricFlags({ face_similarity: 0.9, text_detected: [], composition: { in_center_60: true } }, { faceThreshold: 0.6 }), []);
});

test("読み辞書と台本との一致率", () => {
  assert.equal(applyReadingDict("CIAとCIA長官", [{ from: "CIA", to: "シーアイエー" }, { from: "CIA長官", to: "シーアイエーちょうかん" }]), "シーアイエーとシーアイエーちょうかん");
  assert.equal(applyReadingDict("そのまま", []), "そのまま");
  assert.ok(scriptMatchRate("今日は晴れです。", "今日は晴れです") > 0.95);
  assert.ok(scriptMatchRate("リモートビューイングという技術", "リモート微視という技術") < 0.85);
});

test("出力先: フォーマットで選べない出力先を除き、空なら既定", () => {
  assert.deepEqual(normalizeTargets("vertical_only", ["youtube_long", "tiktok", "tiktok"]), ["tiktok"]);
  assert.deepEqual(normalizeTargets("long_with_clips", []), VIDEO_PROFILES.long_with_clips.defaultTargets);
  assert.equal(VIDEO_TARGETS.ig_reels.platform, "instagram");
  assert.equal(VIDEO_TARGETS.ig_reels.apiSchedule, false);
  assert.equal(VIDEO_TARGETS.youtube_long.burnCaptions, false);
});

test("上限値: 範囲外は丸め、合格ラインは 0.5 未満にできない", () => {
  const l = normalizeLimits({ maxRetries: 99, qcThreshold: 0.1, currency: "jpy", episodeBudget: "120" }, DEFAULT_VIDEO_LIMITS);
  assert.equal(l.maxRetries, 10);
  assert.equal(l.qcThreshold, 0.5);
  assert.equal(l.currency, "USD");
  assert.equal(l.episodeBudget, 120);
});

test("ネタ候補の読み取り: コードフェンス・前置きつきの JSON から URL 付きの候補を取り出す", () => {
  const text = 'こちらです\n```json\n[{"title":"A","angle":"切り口","sources":[{"label":"公式","url":"https://example.com/a"},{"label":"x","url":"ftp://bad"}]},{"title":"","angle":"x"}]\n```';
  const t = parseTopics(text);
  assert.equal(t.length, 1);
  assert.equal(t[0].sources.length, 1);
  assert.deepEqual(parseTopics('{"topics":[{"title":"B","angle":"c","sources":[]}]}').map((x) => x.title), ["B"]);
});

test("概要欄: 導入文・チャプター（3 章以上）・出典・BGM・ハッシュタグ 3 つまで", () => {
  const sl = normalizeShotlist(
    {
      sources: [{ label: "公式発表", url: "https://example.com" }],
      chapters: [{ chapter_id: "ch01", title: "導入" }, { chapter_id: "ch02", title: "本題" }, { chapter_id: "ch03", title: "考察" }],
      shots: [rawShot(1), rawShot(2, { chapter_id: "ch02" }), rawShot(3, { chapter_id: "ch03" })],
    },
    "e"
  );
  const d = buildDescription({ title: "t", script: "台本" }, sl, { timings: [{ shot_id: "s001", start: 0, end: 5 }, { shot_id: "s002", start: 5, end: 70 }, { shot_id: "s003", start: 70, end: 90 }] }, { intro: "導入文です", credits: "曲名 / 作者", hashtags: ["a", "#b", "c", "d"] });
  assert.match(d, /^導入文です/);
  assert.match(d, /0:00 導入\n0:05 本題\n1:10 考察/);
  assert.match(d, /公式発表 https:\/\/example.com/);
  assert.match(d, /曲名 \/ 作者/);
  assert.match(d, /#a #b #c$/);
});

test("タイトルの似ている度合い", () => {
  assert.ok(textSimilarity("未解決事件の真相に迫る", "未解決事件の真相に迫る！") > 0.9);
  assert.ok(textSimilarity("未解決事件の真相", "宇宙人は存在するのか") < 0.2);
});
