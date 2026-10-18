-- AlterTable
ALTER TABLE "sns_accounts" ADD COLUMN "credit_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "automation_paused_at" TIMESTAMP(3),
ADD COLUMN "automation_paused_reason" TEXT;
