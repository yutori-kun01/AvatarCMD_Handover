-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "avatar_ids" TEXT[],
    "all_avatars" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_audit_logs" (
    "id" TEXT NOT NULL,
    "key_id" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "avatar_id" TEXT,
    "status" INTEGER NOT NULL,
    "idempotency_key" TEXT,
    "latency_ms" INTEGER,
    "ip" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "idem_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_rate_counters" (
    "key_id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "window" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "api_rate_counters_pkey" PRIMARY KEY ("key_id","bucket","window")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_audit_logs_key_id_created_at_idx" ON "api_audit_logs"("key_id", "created_at");

-- CreateIndex
CREATE INDEX "api_audit_logs_created_at_idx" ON "api_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_key_id_idem_key_key" ON "idempotency_records"("key_id", "idem_key");

-- CreateIndex
CREATE INDEX "api_rate_counters_window_idx" ON "api_rate_counters"("window");
