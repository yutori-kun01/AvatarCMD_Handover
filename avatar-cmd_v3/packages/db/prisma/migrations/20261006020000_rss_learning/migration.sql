-- CreateTable
CREATE TABLE "rss_feeds" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "site_url" TEXT,
    "avatar_ids" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "poll_hours" INTEGER NOT NULL DEFAULT 6,
    "lookback_days" INTEGER NOT NULL DEFAULT 7,
    "max_items_per_run" INTEGER NOT NULL DEFAULT 3,
    "fetch_full_text" BOOLEAN NOT NULL DEFAULT true,
    "last_polled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rss_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rss_articles" (
    "id" TEXT NOT NULL,
    "feed_row_id" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "excerpt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "content_method" TEXT,
    "content" TEXT,
    "content_at" TIMESTAMP(3),
    "summary" TEXT,
    "summary_evidence" JSONB NOT NULL DEFAULT '{}',
    "knowledge_ids" TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rss_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rss_feeds_url_key" ON "rss_feeds"("url");

-- CreateIndex
CREATE INDEX "rss_articles_status_idx" ON "rss_articles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rss_articles_feed_row_id_guid_key" ON "rss_articles"("feed_row_id", "guid");

-- AddForeignKey
ALTER TABLE "rss_articles" ADD CONSTRAINT "rss_articles_feed_row_id_fkey" FOREIGN KEY ("feed_row_id") REFERENCES "rss_feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

