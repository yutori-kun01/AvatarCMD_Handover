-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "x_policy" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "post_metric_snapshots" (
    "id" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "checkpoint" INTEGER NOT NULL,
    "views" INTEGER,
    "engagements" INTEGER,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "followers" INTEGER,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_metric_snapshots_content_id_checkpoint_key" ON "post_metric_snapshots"("content_id", "checkpoint");

-- CreateIndex
CREATE INDEX "x_users_username_idx" ON "x_users"("username");

-- AddForeignKey
ALTER TABLE "post_metric_snapshots" ADD CONSTRAINT "post_metric_snapshots_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
