import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const adapter = new PrismaBetterSqlite3({ url: "file:./dev.db" });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Avatars ──────────────────────────────────────
  const haru = await prisma.avatar.create({
    data: {
      name: "Haru",
      role: "adhd_introvert",
      specialization: "ADHD対処法 / 内向型の生存戦略",
      targetAudience: "20-30代の内向型エンジニア",
      tone: "優しく共感的、でも核心を突く",
      status: "ACTIVE",
      description: "ADHDと内向性を武器に変える方法を発信。集中力ハック、環境デザイン、セルフケアが専門。",
    },
  });

  const kai = await prisma.avatar.create({
    data: {
      name: "Kai",
      role: "vibe_coder",
      specialization: "バイブコーディング / AI活用開発",
      targetAudience: "AI時代のクリエイティブ開発者",
      tone: "テンション高め、実践重視",
      status: "ACTIVE",
      description: "AIとバイブスで爆速開発。Cursor, Claude, Copilotを使いこなすバイブコーダー。",
    },
  });

  const mio = await prisma.avatar.create({
    data: {
      name: "Mio",
      role: "wellness_coach",
      specialization: "メンタルヘルス / マインドフルネス",
      targetAudience: "燃え尽きかけのIT従事者",
      tone: "穏やかで温かい",
      status: "ACTIVE",
      description: "テック業界のバーンアウトを防ぐ。瞑想、睡眠改善、ストレス管理の実践ガイド。",
    },
  });

  const ren = await prisma.avatar.create({
    data: {
      name: "Ren",
      role: "trend_hunter",
      specialization: "テックトレンド / スタートアップ分析",
      targetAudience: "起業家志望 / 投資家",
      tone: "鋭い分析、データドリブン",
      status: "PAUSED",
      description: "最新テクノロジートレンドを分析し、次のビッグウェーブを予測。",
    },
  });

  const yuki = await prisma.avatar.create({
    data: {
      name: "Yuki",
      role: "knowledge_curator",
      specialization: "学習法 / ナレッジマネジメント",
      targetAudience: "知的好奇心の強いプロフェッショナル",
      tone: "知的で刺激的",
      status: "ACTIVE",
      description: "第二の脳を構築する方法。Obsidian、Zettelkasten、Active Recall の実践者。",
    },
  });

  console.log("  ✅ Created 5 avatars");

  // ─── Platforms ────────────────────────────────────
  await prisma.avatarPlatform.createMany({
    data: [
      { avatarId: haru.id, platform: "X", handle: "haru_adhd", followerCount: 12400 },
      { avatarId: haru.id, platform: "NOTE", handle: "haru-note", followerCount: 3200 },
      { avatarId: kai.id, platform: "X", handle: "kai_vibecoder", followerCount: 8900 },
      { avatarId: kai.id, platform: "ZENN", handle: "kai", followerCount: 1500 },
      { avatarId: kai.id, platform: "YOUTUBE", handle: "KaiCodes", followerCount: 2100 },
      { avatarId: mio.id, platform: "X", handle: "mio_wellness", followerCount: 5600 },
      { avatarId: mio.id, platform: "INSTAGRAM", handle: "mio.mindful", followerCount: 4200 },
      { avatarId: ren.id, platform: "X", handle: "ren_trends", followerCount: 7300 },
      { avatarId: yuki.id, platform: "X", handle: "yuki_knowledge", followerCount: 6100 },
      { avatarId: yuki.id, platform: "NOTE", handle: "yuki-notes", followerCount: 2800 },
    ],
  });
  console.log("  ✅ Created 10 platform connections");

  // ─── Posts ────────────────────────────────────────
  await prisma.post.createMany({
    data: [
      {
        avatarId: haru.id, platform: "X", status: "PUBLISHED",
        content: "ADHDのハイパーフォーカスは「制御できれば」最強のスキル。\n\n今日は3時間ノンストップでコード書いた。\nコツは「ゾーンに入る前の儀式」を決めること。\n\n#ADHD #集中力",
        publishedAt: new Date("2026-04-03T10:30:00Z"),
        engagementData: JSON.stringify({ likes: 342, retweets: 89, impressions: 15200 }),
      },
      {
        avatarId: kai.id, platform: "X", status: "PUBLISHED",
        content: "Claude + Cursor で1日でSaaS作った話。\n\nバイブコーディングの真髄は「完璧を求めないこと」。\n動くものを最速で出して、フィードバックで磨く。\n\n#バイブコーディング #AI開発",
        publishedAt: new Date("2026-04-03T14:00:00Z"),
        engagementData: JSON.stringify({ likes: 567, retweets: 145, impressions: 28900 }),
      },
      {
        avatarId: mio.id, platform: "X", status: "PUBLISHED",
        content: "バーンアウトの前兆サイン5つ:\n\n1. 日曜日の夕方に胃が痛い\n2. 成果が出ても嬉しくない\n3. 同僚との会話が苦痛\n4. 「もう辞めたい」が口癖\n5. 趣味に興味がなくなる\n\n1つでも当てはまったらDMください🌿",
        publishedAt: new Date("2026-04-02T08:00:00Z"),
        engagementData: JSON.stringify({ likes: 1203, retweets: 445, impressions: 52000 }),
      },
      {
        avatarId: haru.id, platform: "X", status: "SCHEDULED",
        content: "内向型エンジニアのための「充電スポット」リスト作ったので共有します。\n\nカフェ＝❌（刺激多すぎ）\n図書館の個人ブース＝◎\n車の中＝◎◎◎（最強）",
        scheduledAt: new Date("2026-04-05T09:00:00Z"),
      },
      {
        avatarId: kai.id, platform: "ZENN", status: "DRAFT",
        content: "【2026年最新】バイブコーディング完全ガイド\n\nClaude 4, GPT-5, Gemini 3.0 の比較と使い分け...",
      },
      {
        avatarId: yuki.id, platform: "X", status: "PUBLISHED",
        content: "Zettelkasten始めて1年。ノート数は2,847個。\n\n最も価値があったのは「ノートを書くこと」ではなく「ノート間のリンクを発見すること」。\n\n知識の島が大陸になる瞬間がたまらない。",
        publishedAt: new Date("2026-04-01T12:00:00Z"),
        engagementData: JSON.stringify({ likes: 891, retweets: 202, impressions: 38000 }),
      },
    ],
  });
  console.log("  ✅ Created 6 posts");

  // ─── Automations ──────────────────────────────────
  await prisma.automation.createMany({
    data: [
      { avatarId: haru.id, name: "毎朝の投稿", trigger: "schedule:daily_09:00", action: "post:generate", status: "ACTIVE", description: "毎朝9時にADHD関連の投稿を自動生成" },
      { avatarId: kai.id, name: "Zenn週次記事", trigger: "schedule:weekly_mon_10:00", action: "post:zenn_article", status: "ACTIVE", description: "毎週月曜にZenn技術記事を生成" },
      { avatarId: mio.id, name: "メンタルヘルスチェック", trigger: "schedule:daily_20:00", action: "post:wellness_tip", status: "ACTIVE", description: "毎晩8時にウェルネスTIPを配信" },
      { avatarId: haru.id, name: "フォロワー分析", trigger: "schedule:weekly_sun_18:00", action: "analytics:follower_report", status: "PAUSED", description: "週次のフォロワー増減レポート生成" },
      { avatarId: yuki.id, name: "論文キャッチアップ", trigger: "schedule:daily_07:00", action: "knowledge:arxiv_scan", status: "ACTIVE", description: "毎朝arXivの新着論文をスキャン" },
    ],
  });
  console.log("  ✅ Created 5 automation rules");

  // ─── Knowledge Items ──────────────────────────────
  await prisma.knowledgeItem.createMany({
    data: [
      { avatarId: haru.id, title: "ADHDのハイパーフォーカス活用法", content: "ハイパーフォーカスを意図的に発動させるための環境設計...", category: "ADHD", tags: JSON.stringify(["集中力", "生産性"]) },
      { avatarId: kai.id, title: "Claude API最適化テクニック", content: "コスト削減しながら品質を維持するプロンプトエンジニアリング...", category: "AI開発", tags: JSON.stringify(["Claude", "プロンプト"]) },
      { avatarId: mio.id, title: "バーンアウト回復の7ステップ", content: "段階的な回復プロセスの詳細ガイド...", category: "メンタルヘルス", tags: JSON.stringify(["バーンアウト", "回復"]) },
      { avatarId: yuki.id, title: "Obsidian プラグイン TOP20", content: "Zettelkasten実践に必須のプラグイン一覧...", category: "PKM", tags: JSON.stringify(["Obsidian", "プラグイン"]) },
    ],
  });
  console.log("  ✅ Created 4 knowledge items");

  // ─── Revenue ──────────────────────────────────────
  await prisma.revenue.createMany({
    data: [
      { avatarId: haru.id, type: "AFFILIATE", amount: 45000, description: "集中力アプリのアフィリエイト", platform: "NOTE" },
      { avatarId: kai.id, type: "MEMBERSHIP", amount: 120000, description: "バイブコーダー有料コミュニティ月額", platform: "X" },
      { avatarId: mio.id, type: "CONSULTATION", amount: 80000, description: "メンタルヘルスコンサル 2件", platform: "X" },
      { avatarId: kai.id, type: "SPONSORSHIP", amount: 200000, description: "Cursor スポンサード記事", platform: "ZENN" },
      { avatarId: yuki.id, type: "PRODUCT_SALE", amount: 35000, description: "Obsidianテンプレート販売", platform: "NOTE" },
    ],
  });
  console.log("  ✅ Created 5 revenue records");

  // ─── Collaborations ───────────────────────────────
  await prisma.collaboration.createMany({
    data: [
      { initiatorId: haru.id, partnerId: kai.id, title: "ADHD × バイブコーディング対談", status: "IN_PROGRESS", description: "X Spaceでのコラボ配信" },
      { initiatorId: mio.id, partnerId: haru.id, title: "メンタルヘルス × ADHD バーンアウト対策", status: "PROPOSED", description: "共同記事の執筆" },
      { initiatorId: kai.id, partnerId: yuki.id, title: "AI × PKM の融合", status: "COMPLETED", description: "Zenn共同技術記事" },
    ],
  });
  console.log("  ✅ Created 3 collaborations");

  // ─── Activities ───────────────────────────────────
  await prisma.activity.createMany({
    data: [
      { avatarId: haru.id, type: "post_published", title: "X に投稿を配信", description: "ADHDのハイパーフォーカスについて" },
      { avatarId: kai.id, type: "post_published", title: "X に投稿を配信", description: "Claude + Cursor でSaaS作成" },
      { avatarId: mio.id, type: "post_published", title: "X に投稿を配信", description: "バーンアウトの前兆サイン5つ" },
      { avatarId: kai.id, type: "revenue_earned", title: "¥200,000 の収益を記録", description: "SPONSORSHIP: Cursor スポンサード記事" },
      { avatarId: haru.id, type: "collab_created", title: "コラボ「ADHD × バイブコーディング対談」を提案" },
      { avatarId: yuki.id, type: "knowledge_added", title: "知識「Obsidian プラグイン TOP20」を追加", description: "カテゴリ: PKM" },
      { avatarId: kai.id, type: "automation_created", title: "自動化ルール「Zenn週次記事」を作成", description: "schedule:weekly_mon_10:00 → post:zenn_article" },
    ],
  });
  console.log("  ✅ Created 7 activity records");

  console.log("\n🎉 Seed complete! Database has been populated with sample data.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
