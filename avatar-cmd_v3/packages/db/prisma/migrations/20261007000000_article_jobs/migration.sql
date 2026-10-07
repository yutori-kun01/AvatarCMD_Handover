-- CreateTable
CREATE TABLE "article_jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "avatar_id" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "progress" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_jobs_status_created_at_idx" ON "article_jobs"("status", "created_at");
