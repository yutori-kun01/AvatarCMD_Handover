-- v3.8: プラットフォーム × ジャンルの傾向（運用側のノウハウ。エクスポートには含めない）
CREATE TABLE "platform_insights" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "lift" DOUBLE PRECISION NOT NULL,
    "agree" DOUBLE PRECISION NOT NULL,
    "avatars" INTEGER NOT NULL,
    "clients" INTEGER NOT NULL,
    "posts" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_insights_platform_genre_feature_key" ON "platform_insights"("platform", "genre", "feature");
CREATE INDEX "platform_insights_platform_genre_idx" ON "platform_insights"("platform", "genre");
