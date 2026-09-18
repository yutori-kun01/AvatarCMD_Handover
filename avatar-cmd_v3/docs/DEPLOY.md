# Avatar CMD v3 — デプロイ手順書（Cloudflare Tunnel + VPS）

このファイルだけを読めばデプロイ作業を再開できるようにしてあります。

## 構成

公開経路は **Cloudflare Tunnel**。VPS 側で 80/443 を一切開けず、
`cloudflared` コンテナが Cloudflare のエッジへ外向き接続を張り、
そこから内部ネットワーク越しに `web:3000` へ転送します。

```
インターネット
  │  https://avatar-cmd.<your-domain>
  ▼
Cloudflare エッジ（TLS 終端・WAF・DDoS 防御）
  │  トンネル（VPS からの外向き接続のみ）
  ▼
cloudflared ──► web:3000 ─┬─► db:5432   (PostgreSQL 16)
                           ├─► redis:6379
                           └─  avatar-data ボリューム (Soul Engine)
                   chrome-empire:4000 (Playwright, 外部非公開)
```

- TLS 証明書の取得・更新は Cloudflare 側が行うため **Traefik と Let's Encrypt は使いません**。
- オリジンの IP アドレスは公開されません。
- ホストにポートを公開しているコンテナはありません（`docker compose config` で確認可能）。

## リソース見積り

| コンテナ | CPU | RAM | ディスク |
|---------|-----|-----|---------|
| web (Next.js) | 1.0 core | 512MB | 500MB |
| db (PostgreSQL 16) | 0.5 core | 512MB | 1-5GB |
| redis | 0.2 core | 192MB | 100MB |
| chrome-empire | 3.0 core | 3GB | 2GB |
| cloudflared | 0.2 core | 128MB | 50MB |
| **合計** | **約4.9 core** | **約4.3GB** | **約8GB** |

---

## 1. Cloudflare 側の準備

Zero Trust ダッシュボード → **Networks → Tunnels** で操作します。

1. `Create a tunnel` → Connector に **Cloudflared** を選択し、名前を付ける（例: `avatar-cmd`）。
2. 表示される **トークン**（`eyJ...` の長い文字列）を控える。
   `docker run ... --token <ここ>` の形で表示されるので、トークン部分だけを使います。
3. `Public Hostname` を追加する。
   - Subdomain: `avatar-cmd`
   - Domain: 対象のドメイン
   - Type: `HTTP`
   - URL: `web:3000` ← **compose のサービス名**。`localhost` ではありません。
4. （推奨）**Access → Applications** でダッシュボードに Cloudflare Access を被せると、
   アプリ側のログインの手前でもう一段認証が入ります。
   `/api/*` に Access をかける場合は、外部から API を叩く用途があるかを確認してから有効化してください。

> トークンはこれ単体でトンネルに接続できる資格情報です。リポジトリにコミットしないでください。

## 2. VPS へ転送

```bash
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  --exclude 'packages/db/generated' --exclude data \
  ./ root@<VPS_IP>:/opt/avatar-cmd/
```

`.dockerignore` があるので、ビルドコンテキストからは上記が自動的に除外されます。

## 3. 環境変数

```bash
ssh root@<VPS_IP>
cd /opt/avatar-cmd

cp .env.example .env
```

`.env` で必ず設定する項目:

| 変数 | 内容 |
|------|------|
| `TUNNEL_TOKEN` | 手順 1 で取得したトンネルのトークン |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `https://avatar-cmd.<your-domain>`（Public hostname と一致させる） |
| `DB_PASSWORD` | PostgreSQL のパスワード |
| `DATABASE_URL` | `postgresql://avatar:<DB_PASSWORD>@db:5432/avatar_cmd?schema=public` |
| `ENCRYPTION_KEY` | 認証情報の AES-256-GCM 暗号化キー |

`DATABASE_URL` のパスワードは `DB_PASSWORD` と一致させてください（別々に書くため、ここがずれると
`migrate` が認証エラーで止まります）。

未設定のまま起動すると compose が明示的にエラーを出します（`DATABASE_URL is required` 等）。

## 4. ビルドと起動

```bash
docker compose build
docker compose up -d
```

起動順は compose が制御します。

1. `db` / `redis` が healthy になる
2. `migrate` が `prisma migrate deploy` を実行して正常終了する
3. `web` が起動し `/api/health` が healthy になる
4. `cloudflared` が接続する

```bash
docker compose ps          # 各サービスの状態
docker compose logs -f web
docker compose logs -f cloudflared
```

> **ビルド時に外向き通信が必要です。** `next/font` が Google Fonts
> （`fonts.googleapis.com` / `fonts.gstatic.com`）からフォントを取得します。
> 取得したフォントはビルド成果物に含まれ実行時の外部通信は発生しませんが、
> 閉じたネットワークでビルドする場合は `next/font/local` への切り替えが必要です。

## 5. 初期管理者の作成

マイグレーションはコンテナ起動時に自動適用されますが、初期ユーザーの投入は手動です。

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=you@example.com \
  -e SEED_ADMIN_PASSWORD='<強いパスワード>' \
  migrate pnpm db:seed
```

`SEED_ADMIN_PASSWORD` を省略するとランダムなパスワードを生成し、実行ログに
1 度だけ表示します（固定の既定パスワードは埋め込んでいません）。
シードはアバター 5 体とダッシュボード用の初期データも投入します。

## 6. 動作確認

```bash
# コンテナ内から（ホストにポートは公開していない）
docker compose exec web node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(console.log)"
# → { status: 'ok', database: 'ok', uptime: ... }

# Chrome Empire のプール状態
docker compose exec chrome-empire node -e \
  "fetch('http://127.0.0.1:4000/status').then(r=>r.json()).then(console.log)"
```

ブラウザで `https://avatar-cmd.<your-domain>/` を開き、`/login` からログインできることを確認します。

---

## 運用

### 更新のデプロイ

```bash
cd /opt/avatar-cmd
git pull                      # または rsync で再転送
docker compose build web
docker compose up -d web      # migrate も自動で再実行される
```

### バックアップ

永続データは 5 つの named volume にあります。少なくとも `db-data` と
`avatar-data` はバックアップ対象です。

```bash
# DB
docker compose exec -T db pg_dump -U avatar avatar_cmd | gzip > db-$(date +%F).sql.gz

# Soul Engine のアバターファイル
docker run --rm -v avatar-cmd_avatar-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/avatar-data-$(date +%F).tar.gz -C /data .
```

ボリューム名の接頭辞はディレクトリ名から決まります。`docker volume ls` で確認してください。

### ログ

```bash
docker compose logs --tail=100 web
docker compose logs --tail=100 cloudflared
```

---

## トラブルシューティング

### `migrate` が認証エラーで止まる
`DATABASE_URL` のパスワードと `DB_PASSWORD` が一致しているか確認してください。
`db` ボリュームを作り直した場合は、初期化時のパスワードが固定されている点にも注意します。

```bash
docker compose logs migrate
```

### ログイン後すぐログイン画面に戻る
`AUTH_URL` が実際のアクセス URL と一致していない場合に起きます。
Cloudflare の Public hostname と `.env` の `AUTH_URL` を揃えてください。
トンネル越しでは `AUTH_TRUST_HOST=true` が必要で、compose で既に設定済みです。

### Cloudflare が 502 を返す
`web` が healthy になっているか、Public hostname の URL が `web:3000`
（`localhost:3000` ではない）になっているかを確認します。

```bash
docker compose ps web
docker compose logs cloudflared | tail -30
```

### `Prisma Client could not locate the Query Engine`
`packages/db/generated` がイメージに入っていない場合に出ます。
Dockerfile の builder ステージで `pnpm --filter @avatar-cmd/db db:generate` が
実行されているか、`schema.prisma` の `binaryTargets` に
`linux-musl-openssl-3.0.x` が含まれているかを確認してください。

### Chrome Empire が起動しない
Playwright のイメージタグと npm パッケージのバージョンは一致させる必要があります。
`Dockerfile` の `mcr.microsoft.com/playwright:v1.63.0-noble` と
`packages/chrome-empire/package.json` の `playwright` を揃えてください。

### メモリ不足
```bash
echo "CHROME_POOL_SIZE=2" >> .env
docker compose up -d chrome-empire
```

---

## 未実装 / 既知の制約

- **ジョブキューは web プロセス内のインメモリ実装**
  （`packages/core/src/scheduler/orchestrator.ts`）。`redis` コンテナは
  起動していますがまだ参照されていません。web を再起動すると未処理ジョブは失われます。
- **chrome-empire はプールの保持と状態公開のみ**。ジョブの受け取り口
  （Redis 経由のキュー）が未実装で、web からブラウザ操作を発注する経路はまだありません。
- `GET /api/content` はモックデータを返します（v3 の SNS 運用画面が参照）。
  実データは `/api/posts` 側です。
- `pnpm lint` は ESLint 未設定のため実行できません。

---

## 重要ファイルパス

| ファイル | 説明 |
|---------|------|
| `README.md` | プロジェクト全体の構成と機能一覧 |
| `docker-compose.yml` | 本番用 Compose（web / db / redis / chrome-empire / migrate / cloudflared） |
| `Dockerfile` | マルチステージビルド（ターゲット: `web` / `migrator` / `chrome-empire`） |
| `.env.example` | 環境変数テンプレート |
| `apps/web/src/lib/auth.ts` | NextAuth 設定（Credentials + ロール） |
| `apps/web/src/middleware.ts` | ダッシュボードと API の保護 |
| `apps/web/src/app/api/health/route.ts` | ヘルスチェック |
| `packages/core/src/security/url-guard.ts` | SSRF 防御 |
| `packages/core/src/persona/soul-engine.ts` | Soul Engine（パス検証込み） |
| `packages/chrome-empire/src/worker.ts` | Chrome Empire のエントリポイント |
