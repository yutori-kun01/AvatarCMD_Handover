#!/usr/bin/env bash
# ============================================
# Avatar CMD — .env 生成スクリプト
# ============================================
# 秘密鍵・パスワードを自動生成して .env を作る。既存の .env は上書きしない。
# 使い方: bash scripts/setup-env.sh [公開URL]
#   例:   bash scripts/setup-env.sh https://avatar-cmd.example.com
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env は既に存在します（上書きしません）。作り直す場合は削除してから実行してください。"
  exit 0
fi

rand() { openssl rand -hex "$1"; }
APP_URL="${1:-http://localhost:3333}"
DB_PASSWORD="$(rand 16)"
ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
DOMAIN="$(echo "$APP_URL" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##')"

cat > .env <<ENV
# ============================================
# Avatar CMD — 環境変数（scripts/setup-env.sh で生成）
# ============================================
# SNS の API キー・トークン等はここではなく、ダッシュボードの「設定」から入力します。
# ここに置くのはサーバーの起動に必要な値だけです。

# --- 公開URL（OAuth のリダイレクトURI・メディア公開URLに使用。設定画面で上書き可） ---
APP_URL=${APP_URL}
DOMAIN=${DOMAIN}

# --- 管理者ログイン（ログイン後、設定 > セキュリティ で変更可） ---
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# --- 暗号鍵（DB に保存する認証情報を暗号化。変更・紛失すると復号不可。必ずバックアップ） ---
ENCRYPTION_KEY=$(rand 32)
SESSION_SECRET=$(rand 32)

# --- Database ---
DB_PASSWORD=${DB_PASSWORD}
# Docker Compose 内から接続する場合（ホスト名 db）
DATABASE_URL=postgresql://avatar:${DB_PASSWORD}@db:5432/avatar_cmd?schema=public

# --- Worker（予約投稿の処理間隔） ---
SCHEDULER_TICK_MS=15000
SCHEDULER_MAX_RETRIES=3

# --- 任意: マーケティングサイトのブログ（Ghost Content API） ---
# GHOST_URL=https://ghost.example.com
# GHOST_CONTENT_API_KEY=
ENV
chmod 600 .env

echo "✅ .env を作成しました"
echo "   公開URL:           ${APP_URL}"
echo "   管理者パスワード:  ${ADMIN_PASSWORD}"
echo "   （このパスワードでダッシュボードにログインしてください）"
echo ""
echo "⚠️  ENCRYPTION_KEY は .env の中にだけあります。.env を安全な場所にバックアップしてください。"
