-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "next_run_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "automation_rules_is_active_next_run_at_idx" ON "automation_rules"("is_active", "next_run_at");
