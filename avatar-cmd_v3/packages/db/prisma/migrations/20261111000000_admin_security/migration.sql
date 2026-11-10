-- v3.9: 管理画面のセキュリティ（サーバー側のセッション・ログインの試行）
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");
CREATE INDEX "login_attempts_created_at_idx" ON "login_attempts"("created_at");
