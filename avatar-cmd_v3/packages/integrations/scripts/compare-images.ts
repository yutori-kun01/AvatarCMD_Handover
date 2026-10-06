// ================================================
// 画像生成の比較テスト（OpenAI / Gemini）— DB 不要・コマンドラインから実行
// ================================================
// 同じプロンプト（と参考画像）で各モデルを生成し、画像・時間・トークン数・概算費用を report.html にまとめる。
// 品質は画像を見て判断し、費用は下の PRICES（1M トークンあたりの USD）で計算する。
//
//   OPENAI_API_KEY=... GEMINI_API_KEY=... pnpm --filter @avatar-cmd/integrations compare-images [出力先] [参考画像のフォルダ]
//
// ・キーが片方だけなら、その社だけ試す。1 枚ごとに課金される（既定の組み合わせで計 4〜8 枚）。
// ・PRICES は 2025 年時点の公開価格を目安に入れてある。実行前に各社の料金ページで確認して直すこと:
//     https://platform.openai.com/docs/pricing  /  https://ai.google.dev/gemini-api/docs/pricing

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { callImageProvider, type ImageProvider, type ImageQuality } from "../src/service/image-gen";
import type { InputImage } from "../src/service/llm";

/** 1M トークンあたりの USD（要確認）。input = テキスト・画像入力、output = 画像出力 */
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-image-1-mini": { input: 2.5, output: 8 },
  "gpt-image-1": { input: 10, output: 40 },
  "gemini-2.5-flash-image": { input: 0.3, output: 30 },
};

const TARGETS: { provider: ImageProvider; model: string; quality?: ImageQuality }[] = [
  { provider: "openai", model: "gpt-image-1-mini", quality: "low" },
  { provider: "openai", model: "gpt-image-1-mini", quality: "medium" },
  { provider: "openai", model: "gpt-image-1", quality: "medium" },
  { provider: "gemini", model: "gemini-2.5-flash-image" },
];

// 記事のイメージ画像として実際に使う形のプロンプト（画像内に文字を入れない）
const PROMPTS = [
  "Editorial illustration for a Japanese blog section. What to depict: 朝の光が差し込むデスクで、ノートに今日の3つのタスクを書き出している人. Art style: flat illustration, soft shapes. Mood: calm, hopeful. Do NOT include any text, letters, numbers, logos or watermarks.",
  "Editorial illustration for a Japanese blog section. What to depict: スマホの通知をオフにして集中している若い会社員、背景に時計. Art style: flat illustration. Mood: focused. Do NOT include any text, letters, numbers, logos or watermarks.",
];

const out = path.resolve(process.argv[2] || "image-compare");
const refDir = process.argv[3];
mkdirSync(out, { recursive: true });
const keys: Record<ImageProvider, string | undefined> = { openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY };
const targets = TARGETS.filter((t) => keys[t.provider]);
if (!targets.length) {
  console.error("OPENAI_API_KEY か GEMINI_API_KEY を設定してください");
  process.exit(1);
}
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const refs: InputImage[] = refDir
  ? readdirSync(refDir)
      .filter((f) => MIME[path.extname(f).toLowerCase()])
      .slice(0, 4)
      .map((f) => ({ mimeType: MIME[path.extname(f).toLowerCase()], data: readFileSync(path.join(refDir, f)).toString("base64") }))
  : [];

interface Row {
  prompt: number;
  provider: string;
  model: string;
  quality: string;
  ok: boolean;
  ms?: number;
  inputTokens?: number;
  outputTokens?: number;
  usd?: number | null;
  file?: string;
  error?: string;
}
const rows: Row[] = [];
for (const [pi, prompt] of PROMPTS.entries()) {
  for (const t of targets) {
    const label = `${t.provider}/${t.model}${t.quality ? `@${t.quality}` : ""}`;
    process.stdout.write(`[${pi + 1}/${PROMPTS.length}] ${label} … `);
    try {
      const r = await callImageProvider(t.provider, keys[t.provider]!, t.model, { prompt, aspect: "16:9", quality: t.quality, references: refs });
      const file = `p${pi + 1}-${t.provider}-${t.model}${t.quality ? `-${t.quality}` : ""}.${r.mimeType.split("/")[1] ?? "png"}`;
      writeFileSync(path.join(out, file), r.bytes);
      const price = PRICES[t.model];
      const input = r.usage.inputTokens + r.usage.cacheReadTokens;
      const usd = price ? (input * price.input + r.usage.outputTokens * price.output) / 1e6 : null;
      rows.push({ prompt: pi + 1, provider: t.provider, model: t.model, quality: t.quality ?? "-", ok: true, ms: r.ms, inputTokens: input, outputTokens: r.usage.outputTokens, usd, file });
      console.log(`${(r.ms / 1000).toFixed(1)}s, out ${r.usage.outputTokens} tok${usd !== null ? `, $${usd.toFixed(4)}` : ""}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      rows.push({ prompt: pi + 1, provider: t.provider, model: t.model, quality: t.quality ?? "-", ok: false, error });
      console.log(`失敗: ${error.slice(0, 200)}`);
    }
  }
}

// モデルごとの平均（1 枚あたり）
const byModel = new Map<string, Row[]>();
for (const r of rows.filter((x) => x.ok)) byModel.set(`${r.provider}/${r.model}@${r.quality}`, [...(byModel.get(`${r.provider}/${r.model}@${r.quality}`) ?? []), r]);
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const summary = [...byModel].map(([k, xs]) => ({ target: k, images: xs.length, avgSeconds: +(avg(xs.map((x) => x.ms!)) / 1000).toFixed(1), avgUsd: xs.every((x) => x.usd !== null) ? +avg(xs.map((x) => x.usd!)).toFixed(4) : null }));
writeFileSync(path.join(out, "summary.json"), JSON.stringify({ prompts: PROMPTS, references: refs.length, summary, rows }, null, 2));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = `<!doctype html><meta charset="utf-8"><title>画像生成の比較</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #ddd;padding:6px 10px;font-size:13px}.grid{display:grid;grid-template-columns:repeat(${targets.length},1fr);gap:12px}figure{margin:0;background:#fff;padding:8px;border:1px solid #ddd}img{width:100%}figcaption{font-size:12px;color:#555}</style>
<h1>画像生成の比較（参考画像 ${refs.length} 枚）</h1>
<p>費用は scripts/compare-images.ts の PRICES（要確認）での概算です。</p>
<table><tr><th>モデル</th><th>枚数</th><th>平均時間</th><th>1枚あたり概算</th></tr>${summary.map((s) => `<tr><td>${s.target}</td><td>${s.images}</td><td>${s.avgSeconds}s</td><td>${s.avgUsd === null ? "単価未設定" : `$${s.avgUsd}`}</td></tr>`).join("")}</table>
${PROMPTS.map((p, i) => `<h2>プロンプト ${i + 1}</h2><p style="font-size:12px">${esc(p)}</p><div class="grid">${rows.filter((r) => r.prompt === i + 1).map((r) => `<figure>${r.ok ? `<img src="${r.file}">` : `<p style="color:#c00">${esc(r.error ?? "")}</p>`}<figcaption>${r.provider}/${r.model} ${r.quality}<br>${r.ok ? `${(r.ms! / 1000).toFixed(1)}s ・ 出力 ${r.outputTokens} tok${r.usd != null ? ` ・ $${r.usd.toFixed(4)}` : ""}` : "失敗"}</figcaption></figure>`).join("")}</div>`).join("")}`;
writeFileSync(path.join(out, "report.html"), html);
console.log(`\n${path.join(out, "report.html")} に結果をまとめました`);
console.table(summary);
