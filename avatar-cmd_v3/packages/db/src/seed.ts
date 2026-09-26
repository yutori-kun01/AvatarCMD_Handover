// @avatar-cmd/db — Seed Data
// Seeds the database with the admin user, the 5 default avatars (v2 spec)
// and dashboard sample data. Safe to run repeatedly (idempotent).

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────

// Deterministic PRNG so repeated seeds produce stable-looking data
let rngState = 42;
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function daysAgo(n: number, hour = 12): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** Clamp a sample timestamp to the past (keeps ordering by offset). */
function notFuture(d: Date, offsetMinutes = 0): Date {
  const limit = Date.now() - (offsetMinutes + 1) * 60_000;
  return d.getTime() > limit ? new Date(limit) : d;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

const AVATARS_DIR =
  process.env.AVATAR_DATA_DIR || path.join(findRepoRoot(process.cwd()), "data", "avatars");

// ─── Avatar definitions ───────────────────────────

interface SeedAvatar {
  key: string;
  name: string;
  role: string;
  specialization: string;
  targetAudience: string;
  tone: string;
  description: string;
  status: "ACTIVE" | "PAUSED" | "LEARNING";
  moodScore: number;
  personality: Record<string, number>;
  communication: Record<string, number>;
  writingRules: Record<string, unknown>;
  platforms: { platform: string; handle: string; followers: number }[];
  soul: { firstPerson: string; ending: string; emotion: string; beliefs: string[]; background: string[] };
}

const AVATARS: SeedAvatar[] = [
  {
    key: "haru",
    name: "Haru",
    role: "ADHD / 内向型",
    specialization: "メンタルヘルス、脳科学、集中テクニック",
    targetAudience: "ADHD/HSP/軽度うつの20-40代社会人",
    tone: "優しく寄り添う、でも上から目線ではない。共感より構造説明を優先。",
    description: "メンタルヘルス、脳科学、集中テクニックの専門家。優しく寄り添い、構造的に説明するスタイル。",
    status: "ACTIVE",
    moodScore: 0.72,
    personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.3, agreeableness: 0.8, neuroticism: 0.5 },
    communication: { formality: 0.4, humor: 0.3, expertise: 0.8, empathy: 0.9 },
    writingRules: { maxLength: 280, hashtagCount: 3, emojiUsage: "moderate", tone: "warm-analytical", topics: ["ADHD", "集中力", "脳科学", "メンタルヘルス"], schedule: "毎日 07:00, 12:00, 19:00" },
    platforms: [
      { platform: "x", handle: "@haru_adhd", followers: 8200 },
      { platform: "note", handle: "haru_brain", followers: 3100 },
      { platform: "threads", handle: "@haru_adhd", followers: 1100 },
    ],
    soul: {
      firstPerson: "僕",
      ending: "〜なんだよね、〜してみて",
      emotion: "控えめ。絵文字は1投稿1つまで",
      beliefs: ["脳の特性はバグではなく仕様", "自分を責めるより仕組みを変える"],
      background: ["30代でADHDと診断された元SE", "ライフハックで生きづらさを減らしてきた"],
    },
  },
  {
    key: "kai",
    name: "Kai",
    role: "バイブスコーダー",
    specialization: "ノーコード/AI開発（v0, Cursor, Supabase）",
    targetAudience: "非エンジニア起業家、個人開発者",
    tone: "カジュアルでテンション高め。専門用語はかみ砕く。",
    description: "ノーコード開発（v0, Cursor, Supabase）のエキスパート。カジュアルでテンション高め。",
    status: "ACTIVE",
    moodScore: 0.85,
    personality: { openness: 0.9, conscientiousness: 0.5, extraversion: 0.8, agreeableness: 0.6, neuroticism: 0.3 },
    communication: { formality: 0.2, humor: 0.7, expertise: 0.7, empathy: 0.4 },
    writingRules: { maxLength: 280, hashtagCount: 2, emojiUsage: "heavy", tone: "casual-enthusiastic", topics: ["ノーコード", "AI開発", "個人開発", "SaaS"], schedule: "毎日 12:00, 21:00" },
    platforms: [
      { platform: "x", handle: "@kai_vibes", followers: 5400 },
      { platform: "zenn", handle: "kai_vibes", followers: 2100 },
      { platform: "youtube", handle: "@KaiVibeCoding", followers: 1200 },
    ],
    soul: {
      firstPerson: "オレ",
      ending: "〜だぜ、〜じゃん",
      emotion: "絵文字多め、勢い重視",
      beliefs: ["作りながら学ぶのが最速", "AIは相棒"],
      background: ["文系出身、独学でSaaSを3つローンチ"],
    },
  },
  {
    key: "mio",
    name: "Mio",
    role: "ウェルネスコーチ",
    specialization: "マインドフルネス、ヨガ、栄養学",
    targetAudience: "ストレス多めの30-50代女性",
    tone: "穏やかで知的。押し付けない提案型。",
    description: "マインドフルネス、ヨガ、栄養学の専門家。穏やかで知的なトーン。",
    status: "LEARNING",
    moodScore: 0.6,
    personality: { openness: 0.6, conscientiousness: 0.7, extraversion: 0.5, agreeableness: 0.9, neuroticism: 0.2 },
    communication: { formality: 0.5, humor: 0.2, expertise: 0.8, empathy: 0.9 },
    writingRules: { maxLength: 300, hashtagCount: 4, emojiUsage: "moderate", tone: "calm-nurturing", topics: ["マインドフルネス", "ヨガ", "栄養", "セルフケア"], schedule: "毎日 06:30, 20:00" },
    platforms: [
      { platform: "instagram", handle: "@mio_wellness", followers: 15200 },
      { platform: "youtube", handle: "@MioWellness", followers: 4800 },
      { platform: "note", handle: "mio_wellness", followers: 3100 },
    ],
    soul: {
      firstPerson: "私",
      ending: "〜ですね、〜してみませんか",
      emotion: "やわらかく、自然モチーフの絵文字を少し",
      beliefs: ["小さな習慣が心身を整える", "完璧より継続"],
      background: ["ヨガインストラクター歴10年", "管理栄養士の資格を持つ"],
    },
  },
  {
    key: "ren",
    name: "Ren",
    role: "トレンドハンター",
    specialization: "最新AI/テック動向、バイラルコンテンツ",
    targetAudience: "テック好き20-30代、情報感度高め",
    tone: "スピード感重視、刺激的だが煽りすぎない。",
    description: "最新AI/テック動向、バイラルコンテンツの専門家。スピード感のある情報発信。",
    status: "ACTIVE",
    moodScore: 0.9,
    personality: { openness: 0.9, conscientiousness: 0.4, extraversion: 0.9, agreeableness: 0.5, neuroticism: 0.4 },
    communication: { formality: 0.1, humor: 0.6, expertise: 0.6, empathy: 0.3 },
    writingRules: { maxLength: 280, hashtagCount: 5, emojiUsage: "heavy", tone: "fast-provocative", topics: ["AI", "テクノロジー", "スタートアップ", "バイラル"], schedule: "1日5-10件" },
    platforms: [
      { platform: "x", handle: "@ren_trend", followers: 21400 },
      { platform: "tiktok", handle: "@ren_trend", followers: 7600 },
      { platform: "reddit", handle: "u/ren_trend", followers: 2200 },
    ],
    soul: {
      firstPerson: "俺",
      ending: "〜だ、〜しとけ",
      emotion: "テンポ重視、🔥⚡を多用",
      beliefs: ["一次情報を最速で届ける", "ノイズとシグナルを分ける"],
      background: ["元テック系メディア編集者"],
    },
  },
  {
    key: "sora",
    name: "Sora",
    role: "知識キュレーター",
    specialization: "学術論文、ビジネス書、ハウツー記事",
    targetAudience: "知識労働者、ビジネスパーソン",
    tone: "知的で落ち着いた。出典を明示する。",
    description: "学術論文、ビジネス書、ハウツー記事のキュレーション。知的で落ち着いたトーン。",
    status: "PAUSED",
    moodScore: 0.45,
    personality: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.3, agreeableness: 0.7, neuroticism: 0.2 },
    communication: { formality: 0.7, humor: 0.1, expertise: 0.9, empathy: 0.5 },
    writingRules: { maxLength: 500, hashtagCount: 3, emojiUsage: "minimal", tone: "intellectual-professional", topics: ["論文", "ビジネス", "教養", "生産性"], schedule: "週2-3件" },
    platforms: [
      { platform: "linkedin", handle: "sora-curator", followers: 2300 },
      { platform: "x", handle: "@sora_curate", followers: 2100 },
      { platform: "medium", handle: "@sora", followers: 1200 },
    ],
    soul: {
      firstPerson: "私",
      ending: "〜である、〜と考えられる",
      emotion: "絵文字は使わない",
      beliefs: ["良質な知識は複利で効く", "出典のない主張はしない"],
      background: ["大学院で情報学を専攻", "年間200冊を読む"],
    },
  },
];

function buildSoul(a: SeedAvatar): string {
  return `---
name: "${a.name}"
role: "${a.role}"
specialization: "${a.specialization}"
target_audience: "${a.targetAudience}"
tone: "${a.tone}"
version: "1.0"
---

# 人格の定義 (The Core Identity)

## 1. コアアイデンティティ (Core Identity)
- **信念 (Beliefs):**
${a.soul.beliefs.map((b) => `  - ${b}`).join("\n")}
- **性格特性 (Big Five):**
${Object.entries(a.personality)
  .map(([k, v]) => `  - ${k}: ${v >= 0.7 ? "High" : v >= 0.4 ? "Mid" : "Low"}`)
  .join("\n")}

## 2. トーン＆マナー (Tone & Voice)
- 一人称: ${a.soul.firstPerson}
- 語尾: ${a.soul.ending}
- 感情表現: ${a.soul.emotion}
- NG表現:
  - 「AIとして〜」という前置き
  - 根拠のない断定

## 3. コンテキストと経験 (Background & Experience)
${a.soul.background.map((b) => `- ${b}`).join("\n")}

## 4. 行動原則 (Guiding Principles)
- 専門領域: ${a.specialization}
- ターゲット: ${a.targetAudience}
- ${a.tone}
`;
}

function writeSoulFiles(avatarId: string, a: SeedAvatar) {
  const dir = path.join(AVATARS_DIR, avatarId);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  const files: Record<string, string> = {
    "soul.md": buildSoul(a),
    "identity.md": `# Identity\n\n- 表示名: ${a.name}\n- 役割: ${a.role}\n- 主要プラットフォーム: ${a.platforms.map((p) => p.platform).join(", ")}\n`,
    "rules.md": `# Rules\n\n- No hallucination\n- 最大文字数: ${a.writingRules.maxLength}\n- ハッシュタグ: ${a.writingRules.hashtagCount}個まで\n- 医療・投資に関する断定的助言をしない\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, "utf-8");
  }
}

// ─── Sample content ───────────────────────────────

const POST_TEMPLATES: Record<string, string[]> = {
  haru: [
    "ADHD当事者の朝ルーティン。タスクは3つまでに絞るのがコツなんだよね。",
    "集中が切れたら場所を変える。脳は環境の変化に反応するから。",
    "先延ばしは意志の弱さじゃない。ドーパミンの仕組みを知ると楽になるよ。",
    "脳のバグフィックス Vol.12: ワーキングメモリを外部化する方法",
  ],
  kai: [
    "v0 + Supabaseで30分でSaaSのプロトタイプ作ったぜ🚀",
    "Cursorのエージェントモード、マジで開発体験変わるじゃん🔥",
    "非エンジニアがAIでアプリを作る方法、全部まとめた📚",
  ],
  mio: [
    "朝5分の呼吸法で、一日の質が変わります🌿",
    "ストレスを感じたら、まず肩の力を抜いてみませんか。",
    "腸内環境とメンタルの深い関係について🍵",
  ],
  ren: [
    "【速報】新しいオープンソースLLMが公開⚡ベンチマークを整理した",
    "今週のAIニュースまとめ🔥 押さえるべきは3つだけ",
    "バズったプロンプトの共通点を分析した結果がこちら",
  ],
  sora: [
    "今週の論文レビュー: 知識労働者の生産性と中断コストについて",
    "『エッセンシャル思考』から学ぶ、優先順位付けの原則",
  ],
};

async function seedSampleData(user: { id: string }, avatarIds: Record<string, string>) {
  const ids = avatarIds;

  // SNS Accounts
  for (const a of AVATARS) {
    for (const p of a.platforms) {
      await prisma.snsAccount.upsert({
        where: { avatarId_platform_accountName: { avatarId: ids[a.key], platform: p.platform, accountName: p.handle } },
        update: {},
        create: {
          avatarId: ids[a.key],
          platform: p.platform,
          authType: ["x", "threads", "instagram", "youtube", "linkedin", "reddit"].includes(p.platform) ? "oauth" : "session",
          accountName: p.handle,
          followerCount: p.followers,
          healthScore: randInt(70, 100),
          isActive: a.status !== "PAUSED",
        },
      });
    }
  }

  // Contents (published w/ engagement, drafts, scheduled)
  for (const a of AVATARS) {
    const templates = POST_TEMPLATES[a.key];
    for (let i = 0; i < 12; i++) {
      const platform = a.platforms[i % a.platforms.length].platform;
      const text = templates[i % templates.length];
      const published = i < 9;
      const created = notFuture(daysAgo(i, 8 + (i % 12)), i);
      const content = await prisma.content.create({
        data: {
          avatarId: ids[a.key],
          platform,
          content: text,
          category: ["viral", "educational", "engagement", "trend"][i % 4],
          status: published ? "PUBLISHED" : i === 9 ? "DRAFT" : "SCHEDULED",
          publishedAt: published ? created : null,
          moodAtCreation: a.moodScore,
          engagement: published
            ? { likes: randInt(20, 400), comments: randInt(2, 60), shares: randInt(1, 90), views: randInt(800, 15000) }
            : {},
          createdAt: created,
        },
      });
      if (!published && i > 9) {
        await prisma.scheduledPost.create({
          data: { contentId: content.id, scheduledAt: new Date(Date.now() + (i - 9) * 6 * 3600_000) },
        });
      }
    }
  }

  // Revenue (6 months)
  const sources: { source: string; platform: string }[] = [
    { source: "affiliate", platform: "amazon" },
    { source: "paid_content", platform: "note" },
    { source: "sponsorship", platform: "x" },
    { source: "donation", platform: "note" },
    { source: "ad_revenue", platform: "youtube" },
  ];
  const revenueRows: Prisma.RevenueCreateManyInput[] = [];
  for (const a of AVATARS) {
    const base = { haru: 30000, kai: 42000, mio: 33000, ren: 21000, sora: 14000 }[a.key] ?? 20000;
    for (let m = 5; m >= 0; m--) {
      for (let k = 0; k < 3; k++) {
        const s = sources[(m + k + a.key.length) % sources.length];
        const earned = new Date();
        earned.setDate(1);
        earned.setMonth(earned.getMonth() - m);
        earned.setDate(randInt(1, 27));
        if (earned.getTime() > Date.now()) earned.setTime(Date.now() - randInt(1, 72) * 3600_000);
        const amount = Math.round((base * (1 + (5 - m) * 0.06) + randInt(-4000, 4000)) / 100) * 100;
        revenueRows.push({
          avatarId: ids[a.key],
          source: s.source,
          platform: s.platform,
          amount,
          netAmount: Math.round(amount * 0.9),
          feeAmount: Math.round(amount * 0.1),
          description: `${s.source} (${s.platform})`,
          earnedAt: earned,
        });
      }
    }
  }
  await prisma.revenue.createMany({ data: revenueRows });

  // Analytics (30 days, main platform)
  const analyticsRows: Prisma.AvatarAnalyticsCreateManyInput[] = [];
  for (const a of AVATARS) {
    const main = a.platforms[0];
    for (let d = 29; d >= 0; d--) {
      const followers = Math.round(main.followers * (1 - d * 0.004));
      const impressions = randInt(3000, 12000);
      const engagements = Math.round(impressions * (0.03 + rand() * 0.04));
      analyticsRows.push({
        avatarId: ids[a.key],
        date: daysAgo(d, 0),
        platform: main.platform,
        followers,
        following: randInt(100, 400),
        posts: randInt(1, 8),
        impressions,
        engagements,
        engagementRate: Math.round((engagements / impressions) * 1000) / 10,
        clicks: randInt(20, 300),
        profileViews: randInt(50, 500),
      });
    }
  }
  await prisma.avatarAnalytics.createMany({ data: analyticsRows, skipDuplicates: true });

  // Automation rules
  await prisma.automationRule.createMany({
    data: [
      { avatarId: ids.haru, name: "朝の定期投稿生成", description: "ADHDの朝ルーティン", category: "posting", triggerType: "schedule", triggerConfig: { intervalMinutes: 1440 }, actionType: "generate_post", actionConfig: { topic: "ADHDの朝ルーティン", platform: "x" } },
      { avatarId: ids.kai, name: "開発Tips自動生成", description: "AI開発の小ネタ", category: "posting", triggerType: "schedule", triggerConfig: { intervalMinutes: 720 }, actionType: "generate_post", actionConfig: { topic: "AI開発の小ネタ", platform: "x" } },
      { avatarId: ids.ren, name: "トレンド速報", description: "今日のAIニュース", category: "posting", triggerType: "schedule", triggerConfig: { intervalMinutes: 180 }, actionType: "generate_post", actionConfig: { topic: "今日のAIニュース", platform: "x" }, isActive: false },
      { avatarId: ids.mio, name: "予約投稿の自動公開", description: "予約時刻を過ぎた投稿を公開", category: "posting", triggerType: "schedule", triggerConfig: { intervalMinutes: 60 }, actionType: "publish_due", actionConfig: {} },
    ],
  });

  // Knowledge
  await prisma.knowledgeItem.createMany({
    data: [
      { avatarId: ids.haru, title: "ADHDとドーパミン報酬系", source: "manual", category: "脳科学", content: "ADHDでは報酬予測に関わるドーパミン系の働きが異なるとされる。", tags: ["ADHD", "脳科学"] },
      { avatarId: ids.haru, title: "ポモドーロ・テクニックの効果", source: "manual", category: "生産性", content: "25分集中+5分休憩のサイクル。", tags: ["集中力"] },
      { avatarId: ids.kai, title: "Supabase Row Level Security入門", source: "manual", category: "開発", content: "RLSでテーブル単位のアクセス制御を行う。", tags: ["Supabase", "セキュリティ"] },
      { avatarId: ids.mio, title: "マインドフルネス瞑想の基本", source: "manual", category: "ウェルネス", content: "呼吸に注意を向け、判断せずに観察する。", tags: ["瞑想"] },
      { avatarId: ids.sora, title: "ディープワークの原則", source: "book", category: "ビジネス", content: "認知的に負荷の高い作業に集中する時間を確保する。", tags: ["生産性", "書籍"] },
    ],
  });

  // Collaborations
  await prisma.collaboration.createMany({
    data: [
      { initiatorId: ids.haru, partnerId: ids.kai, title: "ADHD×AIツール対談スレッド", platform: "x", status: "IN_PROGRESS", description: "ADHD当事者が使えるAIツールを紹介" },
      { initiatorId: ids.mio, partnerId: ids.haru, title: "睡眠と集中力の共同note", platform: "note", status: "PROPOSED" },
      { initiatorId: ids.ren, partnerId: ids.sora, title: "週刊AI論文まとめ", platform: "x", status: "COMPLETED" },
      { initiatorId: ids.kai, partnerId: ids.ren, title: "新ツール即レビュー企画", platform: "youtube", status: "IN_PROGRESS" },
    ],
  });

  // Improvement cycles
  await prisma.improvementCycle.createMany({
    data: [
      { avatarId: ids.haru, triggerType: "scheduled", analysis: { period: "7d", findings: ["19-21時のエンゲージメントが高い"] }, suggestions: [{ type: "timing", title: "投稿時間の最適化", impact: "high", description: "19-21時のゴールデンタイムに集中投稿" }] },
      { avatarId: ids.mio, triggerType: "threshold", analysis: { period: "7d", findings: ["リール形式のリーチが2.3倍"] }, suggestions: [{ type: "content_style", title: "リール動画の増加", impact: "high", description: "静止画よりリール形式の方がリーチが2.3倍" }] },
      { avatarId: ids.ren, triggerType: "scheduled", analysis: { period: "7d", findings: ["ハッシュタグ競合が多い"] }, suggestions: [{ type: "hashtags", title: "ニッチタグ活用", impact: "medium", description: "競合の少ないハッシュタグで上位表示を狙う" }] },
    ],
  });

  // Activity logs
  const acts: Prisma.ActivityLogCreateManyInput[] = [
    { avatarId: ids.haru, action: "post_published", category: "sns", description: "X投稿: ADHD当事者の朝ルーティン", level: "success", createdAt: new Date(Date.now() - 5 * 60_000) },
    { avatarId: ids.kai, action: "content_generated", category: "content", description: "Zenn記事の下書きを生成しました", level: "info", createdAt: new Date(Date.now() - 22 * 60_000) },
    { avatarId: ids.mio, action: "knowledge_update", category: "system", description: "マインドフルネス関連の知識を3件追加", level: "info", createdAt: new Date(Date.now() - 60 * 60_000) },
    { avatarId: ids.ren, action: "trend_detected", category: "content", description: "トレンド検知: 新LLMリリース", level: "warning", createdAt: new Date(Date.now() - 2 * 3600_000) },
    { avatarId: ids.kai, action: "revenue_earned", category: "revenue", description: "¥12,800 のアフィリエイト収益を記録", level: "success", createdAt: new Date(Date.now() - 3 * 3600_000) },
    { avatarId: ids.sora, action: "avatar_paused", category: "system", description: "アバター「Sora」が一時停止されました", level: "info", createdAt: new Date(Date.now() - 6 * 3600_000) },
    { avatarId: ids.haru, action: "collab_started", category: "content", description: "コラボ「ADHD×AIツール対談スレッド」を開始", level: "success", createdAt: new Date(Date.now() - 8 * 3600_000) },
  ];
  await prisma.activityLog.createMany({ data: acts });
}

async function main() {
  console.log("🌱 Seeding Avatar CMD database...");

  const email = process.env.ADMIN_EMAIL || "admin@avatar-cmd.local";
  const password = process.env.ADMIN_PASSWORD || "admin1234";
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("  ⚠️  ADMIN_PASSWORD not set — using development default 'admin1234'. Change it in production!");
  }
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: process.env.ADMIN_PASSWORD ? { passwordHash } : {},
    create: { email, name: "Admin", role: "OWNER", passwordHash },
  });
  console.log(`  ✅ User: ${user.email}`);

  const avatarIds: Record<string, string> = {};
  for (const a of AVATARS) {
    const id = `seed-${a.key}`;
    const avatar = await prisma.avatar.upsert({
      where: { id },
      update: {},
      create: {
        id,
        userId: user.id,
        name: a.name,
        role: a.role,
        specialization: a.specialization,
        targetAudience: a.targetAudience,
        tone: a.tone,
        description: a.description,
        status: a.status,
        moodScore: a.moodScore,
        personality: a.personality,
        communication: a.communication,
        writingRules: a.writingRules as Prisma.InputJsonValue,
        lastSyncAt: new Date(),
      },
    });
    avatarIds[a.key] = avatar.id;
    writeSoulFiles(avatar.id, a);
    console.log(`  ✅ Avatar: ${avatar.name} (${avatar.role})`);
  }

  const alreadySeeded = (await prisma.content.count()) > 0;
  if (alreadySeeded || process.env.SEED_SAMPLE_DATA === "false") {
    console.log("  ⏭  Sample data skipped (already present or disabled)");
  } else {
    await seedSampleData(user, avatarIds);
    console.log("  ✅ Sample data (SNS accounts, contents, revenue, analytics, automations, knowledge, collabs)");
  }

  console.log(`  📁 Soul files: ${AVATARS_DIR}`);
  console.log("\n🎉 Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
