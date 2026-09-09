# ============================================
# Avatar CMD v3 — VPSデプロイ手順書
# ============================================
# このドキュメントは別会話ウィンドウでも最初にこのファイルを
# 読むだけで、VPSデプロイ作業を継続できます。
# ============================================

## 前提条件

| 項目 | 値 |
|------|------|
| VPS | Xserver VPS (AMD EPYC 6-core, 12GB RAM, 336GB空き) |
| OS | Ubuntu 22.04.5 LTS |
| 稼働中 | Traefik, Portainer, n8n, OpenClaw, Ghost等 (10コンテナ) |
| Docker空きRAM | ~8.5GB（現在3.4GB使用中） |
| Docker空きディスク | ~300GB |

## Avatar CMD リソース見積り

| コンテナ | CPU | RAM | ディスク |
|---------|-----|-----|---------|
| web (Next.js) | 1.0 core | 512MB | 500MB |
| db (PostgreSQL 16) | 0.5 core | 512MB | 1-5GB |
| redis | 0.2 core | 192MB | 100MB |
| chrome-empire | 3.0 core | 3GB | 2GB |
| **合計** | **4.7 core** | **~4.2GB** | **~8GB** |

> 現在のVPSメモリ空き8.5GBに対して4.2GB利用 → **十分余裕あり** ✅

---

## デプロイ手順

### 1. プロジェクト転送

```bash
# ローカルPCから VPS へ転送
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  /c/Users/retim/Desktop/OpenClaw/01_開発/avatar-cmd/ \
  root@<VPS_IP>:/opt/avatar-cmd/
```

### 2. VPSでセットアップ

```bash
ssh root@<VPS_IP>
cd /opt/avatar-cmd

# 環境変数設定
cp .env.example .env
nano .env  # DB_PASSWORD, NEXTAUTH_SECRET, DOMAIN 等を設定
```

### 3. Traefikネットワーク確認

```bash
# 既存のTraefikネットワーク名を確認
docker network ls | grep traefik

# docker-compose.yml の traefik-net を既存ネットワーク名に合わせる
# 例: ネットワーク名が "traefik_default" なら:
#   traefik-net:
#     external: true
#     name: traefik_default
```

### 4. ビルド & 起動

```bash
# ビルド
docker compose build

# 起動
docker compose up -d

# ログ確認
docker compose logs -f web

# ステータス確認
docker compose ps
```

### 5. Prismaマイグレーション

```bash
# 初回のみ: DB スキーマ作成
docker compose exec web npx prisma migrate deploy
docker compose exec web npx prisma db seed
```

### 6. 動作確認

```bash
# APIエンドポイント確認
curl http://localhost:3333/api/platforms | jq '.totalPlatforms'
# → 16

# ダッシュボード確認
# ブラウザで https://avatar-cmd.<your-domain>/ を開く
```

---

## トラブルシューティング

### ビルドエラー
```bash
# キャッシュクリアして再ビルド
docker compose build --no-cache
```

### メモリ不足
```bash
# Chrome Empireのプールサイズを削減
echo "CHROME_POOL_SIZE=2" >> .env
docker compose up -d chrome-empire
```

### DB接続エラー
```bash
# DBコンテナの状態確認
docker compose logs db
docker compose exec db pg_isready -U avatar
```

### Traefik証明書
```bash
# Traefikのルーティング確認
docker compose logs traefik 2>&1 | grep avatar-cmd
```

---

## 重要ファイルパス

| ファイル | 説明 |
|---------|------|
| `README.md` | プロジェクト全体の構成と機能一覧 |
| `docker-compose.yml` | 本番用Docker Compose (4サービス) |
| `Dockerfile` | マルチステージビルド |
| `.env.example` | 環境変数テンプレート |
| `packages/core/src/index.ts` | 全コアサービスのエクスポート |
| `packages/integrations/src/index.ts` | 全SNSプロバイダーのエクスポート |
| `apps/web/src/components/dashboard/sidebar.tsx` | サイドバーナビゲーション (全7ページ) |

---

## 別ウィンドウでの引き継ぎ方法

1. **最初に** `README.md` を読む → プロジェクト全体像を把握
2. **デプロイする場合** → この `docs/DEPLOY.md` に従う
3. **開発を続ける場合** → `packages/core/src/index.ts` と `packages/integrations/src/index.ts` を確認
4. **UIを修正する場合** → `apps/web/src/app/` 配下の各 `page.tsx` を確認
5. **新しいSNSプロバイダーを追加する場合** → `packages/integrations/src/providers/platforms.ts` にクラスを追加し、`index.ts` のレジストリに登録
