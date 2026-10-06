-- AlterTable
ALTER TABLE "account_snapshots" ADD COLUMN     "engagements" INTEGER,
ADD COLUMN     "engagements_total" INTEGER,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "views" INTEGER,
ADD COLUMN     "views_total" INTEGER;

-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "avatar_image_source" TEXT,
ADD COLUMN     "image_style" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "sns_accounts" ADD COLUMN     "profile_image_hash" TEXT,
ADD COLUMN     "profile_image_url" TEXT;

-- CreateTable
CREATE TABLE "style_references" (
    "id" TEXT NOT NULL,
    "avatar_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "media_name" TEXT NOT NULL,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "style_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "style_references_avatar_id_kind_idx" ON "style_references"("avatar_id", "kind");

-- AddForeignKey
ALTER TABLE "style_references" ADD CONSTRAINT "style_references_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
