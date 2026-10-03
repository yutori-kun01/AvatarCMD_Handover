-- AlterTable
ALTER TABLE "improvement_cycles" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "error" TEXT,
ADD COLUMN     "lease_until" TIMESTAMP(3),
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'suggest',
ADD COLUMN     "next_interval_days" INTEGER,
ADD COLUMN     "run_status" TEXT NOT NULL DEFAULT 'completed',
ADD COLUMN     "scheduled_for" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "knowledge_items" ADD COLUMN     "created_by" TEXT NOT NULL DEFAULT 'human',
ADD COLUMN     "evidence" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'fact',
ADD COLUMN     "scope" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "source_fetched_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "improvement_schedules" (
    "avatar_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'suggest',
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_cycle_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "improvement_schedules_pkey" PRIMARY KEY ("avatar_id")
);

-- CreateTable
CREATE TABLE "knowledge_revisions" (
    "id" TEXT NOT NULL,
    "knowledge_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "improvement_schedules_enabled_next_run_at_idx" ON "improvement_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_revisions_knowledge_id_version_key" ON "knowledge_revisions"("knowledge_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_cycles_avatar_id_scheduled_for_key" ON "improvement_cycles"("avatar_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "knowledge_items_avatar_id_status_idx" ON "knowledge_items"("avatar_id", "status");

-- AddForeignKey
ALTER TABLE "improvement_schedules" ADD CONSTRAINT "improvement_schedules_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_revisions" ADD CONSTRAINT "knowledge_revisions_knowledge_id_fkey" FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 既存のナレッジ: 無効化済み（is_active=false）は status=disabled に揃える（既定は fact / active / version 1）
UPDATE "knowledge_items" SET "status" = 'disabled' WHERE "is_active" = false;
