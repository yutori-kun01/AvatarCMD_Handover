-- CreateTable
CREATE TABLE "growth_states" (
    "sns_account_id" TEXT NOT NULL,
    "phase" JSONB NOT NULL DEFAULT '{}',
    "tuning" JSONB NOT NULL DEFAULT '{}',
    "arms" JSONB NOT NULL DEFAULT '{}',
    "history" JSONB NOT NULL DEFAULT '[]',
    "evaluated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_states_pkey" PRIMARY KEY ("sns_account_id")
);

-- AddForeignKey
ALTER TABLE "growth_states" ADD CONSTRAINT "growth_states_sns_account_id_fkey" FOREIGN KEY ("sns_account_id") REFERENCES "sns_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
