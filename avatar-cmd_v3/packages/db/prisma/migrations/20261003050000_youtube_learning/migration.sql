-- CreateTable
CREATE TABLE "youtube_channels" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "title" TEXT,
    "ownership" TEXT NOT NULL DEFAULT 'other',
    "avatar_ids" TEXT[],
    "owner_account_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "poll_hours" INTEGER NOT NULL DEFAULT 24,
    "lookback_days" INTEGER NOT NULL DEFAULT 30,
    "max_videos_per_run" INTEGER NOT NULL DEFAULT 3,
    "last_polled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_videos" (
    "id" TEXT NOT NULL,
    "channel_row_id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "description" TEXT,
    "transcript_status" TEXT NOT NULL DEFAULT 'pending',
    "transcript_method" TEXT,
    "transcript" TEXT,
    "transcript_at" TIMESTAMP(3),
    "summary" TEXT,
    "summary_evidence" JSONB NOT NULL DEFAULT '{}',
    "knowledge_ids" TEXT[],
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "youtube_channels_channel_id_key" ON "youtube_channels"("channel_id");

-- CreateIndex
CREATE INDEX "youtube_videos_transcript_status_idx" ON "youtube_videos"("transcript_status");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_videos_channel_row_id_video_id_key" ON "youtube_videos"("channel_row_id", "video_id");

-- AddForeignKey
ALTER TABLE "youtube_videos" ADD CONSTRAINT "youtube_videos_channel_row_id_fkey" FOREIGN KEY ("channel_row_id") REFERENCES "youtube_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

