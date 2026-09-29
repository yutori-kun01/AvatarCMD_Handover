-- AlterTable
ALTER TABLE "oauth_states" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'redirect',
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "result" TEXT;
