-- CreateTable
CREATE TABLE "video_episodes" (
    "id" TEXT NOT NULL,
    "avatar_id" TEXT NOT NULL,
    "episode_key" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "profile" TEXT NOT NULL DEFAULT 'long_with_clips',
    "format" TEXT,
    "targets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage" TEXT NOT NULL DEFAULT 'topics',
    "status" TEXT NOT NULL DEFAULT 'active',
    "theme" TEXT,
    "topics" JSONB NOT NULL DEFAULT '[]',
    "script" TEXT,
    "shotlist" JSONB NOT NULL DEFAULT '{}',
    "narration" JSONB NOT NULL DEFAULT '{}',
    "renders" JSONB NOT NULL DEFAULT '{}',
    "thumbnails" JSONB NOT NULL DEFAULT '[]',
    "publish_plan" JSONB NOT NULL DEFAULT '{}',
    "approvals" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_shotlist_revisions" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "reason" TEXT,
    "by" TEXT NOT NULL DEFAULT 'system',
    "shotlist" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_shotlist_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_jobs" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "shot_id" TEXT,
    "input_hash" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress" TEXT,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_episodes_episode_key_key" ON "video_episodes"("episode_key");

-- CreateIndex
CREATE INDEX "video_episodes_avatar_id_created_at_idx" ON "video_episodes"("avatar_id", "created_at");

-- CreateIndex
CREATE INDEX "video_episodes_status_stage_idx" ON "video_episodes"("status", "stage");

-- CreateIndex
CREATE INDEX "video_shotlist_revisions_episode_id_created_at_idx" ON "video_shotlist_revisions"("episode_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_jobs_input_hash_key" ON "video_jobs"("input_hash");

-- CreateIndex
CREATE INDEX "video_jobs_status_created_at_idx" ON "video_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "video_jobs_episode_id_step_idx" ON "video_jobs"("episode_id", "step");

-- AddForeignKey
ALTER TABLE "video_episodes" ADD CONSTRAINT "video_episodes_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_shotlist_revisions" ADD CONSTRAINT "video_shotlist_revisions_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "video_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "video_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

