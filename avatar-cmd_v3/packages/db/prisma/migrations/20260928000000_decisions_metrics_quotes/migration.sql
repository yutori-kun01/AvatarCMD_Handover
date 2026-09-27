-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "metrics_updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "decision_events" (
    "id" TEXT NOT NULL,
    "avatar_id" TEXT,
    "decision_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "engine" TEXT NOT NULL,
    "model" TEXT,
    "mode" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "selected_action" TEXT,
    "confidence" DOUBLE PRECISION,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "human_action" TEXT,
    "latency_ms" INTEGER,
    "usage" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_candidates" (
    "id" TEXT NOT NULL,
    "avatar_id" TEXT NOT NULL,
    "sns_account_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_post_id" TEXT NOT NULL,
    "author_id" TEXT,
    "author_username" TEXT,
    "text" TEXT NOT NULL,
    "url" TEXT,
    "posted_at" TIMESTAMP(3),
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "angle" TEXT,
    "content_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_events_decision_type_created_at_idx" ON "decision_events"("decision_type", "created_at");

-- CreateIndex
CREATE INDEX "decision_events_subject_id_idx" ON "decision_events"("subject_id");

-- CreateIndex
CREATE INDEX "quote_candidates_avatar_id_status_idx" ON "quote_candidates"("avatar_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_candidates_avatar_id_platform_external_post_id_key" ON "quote_candidates"("avatar_id", "platform", "external_post_id");

-- CreateIndex
CREATE INDEX "contents_status_published_at_idx" ON "contents"("status", "published_at");

-- AddForeignKey
ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_candidates" ADD CONSTRAINT "quote_candidates_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

