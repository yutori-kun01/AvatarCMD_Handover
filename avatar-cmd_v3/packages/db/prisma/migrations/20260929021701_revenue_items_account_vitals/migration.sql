-- AlterTable
ALTER TABLE "revenues" ADD COLUMN     "item_id" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sns_account_id" TEXT;

-- AlterTable
ALTER TABLE "sns_accounts" ADD COLUMN     "followers_error" TEXT,
ADD COLUMN     "followers_updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "account_snapshots" (
    "id" TEXT NOT NULL,
    "sns_account_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER,
    "following" INTEGER,
    "posts" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_items" (
    "id" TEXT NOT NULL,
    "avatar_id" TEXT NOT NULL,
    "sns_account_id" TEXT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'paid_content',
    "platform" TEXT NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_snapshots_sns_account_id_date_key" ON "account_snapshots"("sns_account_id", "date");

-- CreateIndex
CREATE INDEX "revenues_earned_at_idx" ON "revenues"("earned_at");

-- CreateIndex
CREATE INDEX "revenues_sns_account_id_earned_at_idx" ON "revenues"("sns_account_id", "earned_at");

-- AddForeignKey
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_sns_account_id_fkey" FOREIGN KEY ("sns_account_id") REFERENCES "sns_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_sns_account_id_fkey" FOREIGN KEY ("sns_account_id") REFERENCES "sns_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "revenue_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_items" ADD CONSTRAINT "revenue_items_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_items" ADD CONSTRAINT "revenue_items_sns_account_id_fkey" FOREIGN KEY ("sns_account_id") REFERENCES "sns_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
