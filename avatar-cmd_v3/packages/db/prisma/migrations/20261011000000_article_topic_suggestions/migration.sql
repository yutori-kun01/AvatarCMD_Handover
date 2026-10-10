-- CreateTable
CREATE TABLE "article_topic_suggestions" (
    "id" TEXT NOT NULL,
    "avatar_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'persona',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "position" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_topic_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_topic_suggestions_rule_id_status_position_idx" ON "article_topic_suggestions"("rule_id", "status", "position");

-- AddForeignKey
ALTER TABLE "article_topic_suggestions" ADD CONSTRAINT "article_topic_suggestions_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_topic_suggestions" ADD CONSTRAINT "article_topic_suggestions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

