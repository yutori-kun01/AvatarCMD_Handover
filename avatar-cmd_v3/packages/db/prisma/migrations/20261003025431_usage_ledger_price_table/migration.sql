-- CreateTable
CREATE TABLE "usage_ledger" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "avatar_id" TEXT,
    "purpose" TEXT NOT NULL,
    "context" TEXT,
    "subject_id" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 1,
    "reads" INTEGER NOT NULL DEFAULT 0,
    "quota_units" INTEGER NOT NULL DEFAULT 0,
    "is_retry" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_entries" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '*',
    "unit" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "per" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_ledger_occurred_at_idx" ON "usage_ledger"("occurred_at");

-- CreateIndex
CREATE INDEX "usage_ledger_avatar_id_occurred_at_idx" ON "usage_ledger"("avatar_id", "occurred_at");

-- CreateIndex
CREATE INDEX "price_entries_provider_unit_effective_from_idx" ON "price_entries"("provider", "unit", "effective_from");
