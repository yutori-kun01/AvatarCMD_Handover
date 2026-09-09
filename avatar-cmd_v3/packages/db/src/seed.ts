// @avatar-cmd/db — Seed Data
// Seeds the database with default avatars for development

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Avatar CMD database...");

  // Create default user
  const user = await prisma.user.upsert({
    where: { email: "admin@avatar-cmd.local" },
    update: {},
    create: {
      email: "admin@avatar-cmd.local",
      name: "Admin",
      role: "OWNER",
    },
  });

  console.log(`  ✅ User: ${user.email}`);

  // Default Avatars (from Avatar CMD v2 spec)
  const avatars = [
    {
      name: "Haru",
      role: "ADHD / 内向型",
      description: "メンタルヘルス、脳科学、集中テクニックの専門家。優しく寄り添い、構造的に説明するスタイル。",
      personality: {
        openness: 0.7,
        conscientiousness: 0.8,
        extraversion: 0.3,
        agreeableness: 0.8,
        neuroticism: 0.5,
      },
      communication: {
        formality: 0.4,
        humor: 0.3,
        expertise: 0.8,
        empathy: 0.9,
      },
      writingRules: {
        maxLength: 280,
        hashtagCount: 3,
        emojiUsage: "moderate",
        tone: "warm-analytical",
        topics: ["ADHD", "集中力", "脳科学", "メンタルヘルス"],
      },
    },
    {
      name: "Kai",
      role: "バイブスコーダー",
      description: "ノーコード開発（v0, Cursor, Supabase）のエキスパート。カジュアルでテンション高め。",
      personality: {
        openness: 0.9,
        conscientiousness: 0.5,
        extraversion: 0.8,
        agreeableness: 0.6,
        neuroticism: 0.3,
      },
      communication: {
        formality: 0.2,
        humor: 0.7,
        expertise: 0.7,
        empathy: 0.4,
      },
      writingRules: {
        maxLength: 280,
        hashtagCount: 2,
        emojiUsage: "heavy",
        tone: "casual-enthusiastic",
        topics: ["ノーコード", "AI開発", "個人開発", "SaaS"],
      },
    },
    {
      name: "Mio",
      role: "ウェルネスコーチ",
      description: "マインドフルネス、ヨガ、栄養学の専門家。穏やかで知的なトーン。",
      personality: {
        openness: 0.6,
        conscientiousness: 0.7,
        extraversion: 0.5,
        agreeableness: 0.9,
        neuroticism: 0.2,
      },
      communication: {
        formality: 0.5,
        humor: 0.2,
        expertise: 0.8,
        empathy: 0.9,
      },
      writingRules: {
        maxLength: 300,
        hashtagCount: 4,
        emojiUsage: "moderate",
        tone: "calm-nurturing",
        topics: ["マインドフルネス", "ヨガ", "栄養", "セルフケア"],
      },
    },
    {
      name: "Ren",
      role: "トレンドハンター",
      description: "最新AI/テック動向、バイラルコンテンツの専門家。スピード感のある情報発信。",
      personality: {
        openness: 0.9,
        conscientiousness: 0.4,
        extraversion: 0.9,
        agreeableness: 0.5,
        neuroticism: 0.4,
      },
      communication: {
        formality: 0.1,
        humor: 0.6,
        expertise: 0.6,
        empathy: 0.3,
      },
      writingRules: {
        maxLength: 280,
        hashtagCount: 5,
        emojiUsage: "heavy",
        tone: "fast-provocative",
        topics: ["AI", "テクノロジー", "スタートアップ", "バイラル"],
      },
    },
    {
      name: "Sora",
      role: "知識キュレーター",
      description: "学術論文、ビジネス書、ハウツー記事のキュレーション。知的で落ち着いたトーン。",
      personality: {
        openness: 0.8,
        conscientiousness: 0.9,
        extraversion: 0.3,
        agreeableness: 0.7,
        neuroticism: 0.2,
      },
      communication: {
        formality: 0.7,
        humor: 0.1,
        expertise: 0.9,
        empathy: 0.5,
      },
      writingRules: {
        maxLength: 500,
        hashtagCount: 3,
        emojiUsage: "minimal",
        tone: "intellectual-professional",
        topics: ["論文", "ビジネス", "教養", "生産性"],
      },
    },
  ];

  for (const avatarData of avatars) {
    const avatar = await prisma.avatar.upsert({
      where: {
        id: `seed-${avatarData.name.toLowerCase()}`,
      },
      update: {},
      create: {
        id: `seed-${avatarData.name.toLowerCase()}`,
        userId: user.id,
        name: avatarData.name,
        role: avatarData.role,
        description: avatarData.description,
        personality: avatarData.personality,
        communication: avatarData.communication,
        writingRules: avatarData.writingRules,
        status: "ACTIVE",
      },
    });
    console.log(`  ✅ Avatar: ${avatar.name} (${avatar.role})`);
  }

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
