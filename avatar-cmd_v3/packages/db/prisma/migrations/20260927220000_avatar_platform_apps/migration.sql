-- AlterTable
ALTER TABLE "sns_accounts" ADD COLUMN     "app_scope" TEXT NOT NULL DEFAULT 'shared';

-- CreateTable
CREATE TABLE "avatar_platform_apps" (
    "avatar_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_platform_apps_pkey" PRIMARY KEY ("avatar_id","platform")
);

-- AddForeignKey
ALTER TABLE "avatar_platform_apps" ADD CONSTRAINT "avatar_platform_apps_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

