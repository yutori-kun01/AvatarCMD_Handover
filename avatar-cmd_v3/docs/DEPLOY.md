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
cloudflared ──► web:3000 ─┬─► db:5432    (PostgreSQL 16)
                           ├─► redis:6379 (BullMQ ジョブキュー)
                           └─  avatar-data ボリューム (Soul Engine)

redis:6379 ◄─┬─ worker:4100        (AI生成 / ナレッジ収集)
             └─ chrome-empire:4000 (Playwright, ブラウザ操作)
```

ジョブは web が Redis に投入し、worker と chrome-empire が消費します。
web はジョブを処理しないため、web の再起動でジョブは失われません。

自律運用の流れ:

```
worker の tick (既定30秒)
  ├─ AutomationRule (cron) を評価 ──► generate_post ジョブ
  └─ 期限が来た ScheduledPost ─────► publish_post ジョブ

generate_post → Gemini で本文生成 → Content を DRAFT で保存
publish_post  → Provider の API 投稿を試す
                 ├─ 成功        → Content を PUBLISHED に
                 └─ ブラウザ必要 → ブラウザキューへ操作列を投入
                                    → chrome-empire が Playwright で実行
                                    → 結果を browser_result として app キューへ戻す
                                    → worker が Content を PUBLISHED / FAILED に確定
```

chrome-empire は DB を持たないため、Content の更新は必ず worker が行います。
結果が返らないまま `PUBLISHING` で残った Content は、tick が
`PUBLISHING_TIMEOUT_MS`（既定15分）経過後に FAILED へ倒します。

- TLS 証明書の取得・更新は Cloudflare 側が行うため **Traefik と Let's Encrypt は使いません**。
- オリジンの IP アドレスは公開されません。
- ホストにポートを公開しているコンテナはありません（`docker compose config` で確認可能）。

## リソース見積り

| コンテナ | CPU | RAM | ディスク |
|---------|-----|-----|---------|
| web (Next.js) | 1.0 core | 512MB | 500MB |
| worker | 1.0 core | 512MB | 100MB |
| db (PostgreSQL 16) | 0.5 core | 512MB | 1-5GB |
| redis | 0.2 core | 256MB | 200MB |
| chrome-empire | 3.0 core | 3GB | 2GB |
| cloudflared | 0.2 core | 128MB | 50MB |
| **合計** | **約5.9 core** | **約4.9GB** | **約8GB** |

> CPU の割当合計がコア数を超える場合、`deploy.resources.limits` は
> 上限であって予約ではないため起動はしますが、同時に負荷がかかると
> 取り合いになります。ブラウザ操作を使わない間は
> `CHROME_POOL_SIZE` を下げるか chrome-empire を停止してください。

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
3. `web` と `worker` が起動し、それぞれ healthy になる
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

# worker の状態
docker compose exec worker node -e \
  "fetch('http://127.0.0.1:4100/health').then(r=>r.json()).then(console.log)"

# Chrome Empire のプールとブラウザキューの状態
docker compose exec chrome-empire node -e \
  "fetch('http://127.0.0.1:4000/status').then(r=>r.json()).then(console.log)"
```

キューの状態はダッシュボードの API からも確認できます。

```bash
# 要ログイン（Cookie 付きで叩く）
curl https://avatar-cmd.<your-domain>/api/queue/trigger
# → { app: { waiting, active, completed, failed, delayed }, browser: {...} }
```

ブラウザで `https://avatar-cmd.<your-domain>/` を開き、`/login` からログインできることを確認します。

---

## 運用

### 更新のデプロイ

```bash
cd /opt/avatar-cmd
git pull                      # または rsync で再転送
docker compose build web worker
docker compose up -d web worker   # migrate も自動で再実行される
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

### 自動化ルールが発火しない
`triggerType` が `schedule`、`isActive` が true、`triggerConfig.cron` が
5フィールドの cron 式になっているかを確認します。
初回の tick では発火せず基準時刻（`lastExecutedAt`）を入れるだけなので、
1周期分待つ必要があります。解析に失敗した cron は `lastError` に残ります。

`actionType` は以下のみ対応しています。それ以外は `lastError` に記録されます。

| actionType | 投入されるジョブ |
|-----------|----------------|
| `post` / `generate` | `generate_post` |
| `publish` | `publish_post` |
| `scrape` / `knowledge` | `fetch_knowledge` |

スケジューラを止めたい場合は `SCHEDULER_ENABLED=false` を設定します。

```bash
docker compose logs --tail=50 worker | grep -E "Tick|Scheduler"
```

### 投稿が PUBLISHING のまま止まる
ブラウザ操作へ回された投稿です。chrome-empire が動いていれば結果が
`browser_result` として返り、worker が PUBLISHED / FAILED に確定させます。
15分（`PUBLISHING_TIMEOUT_MS`）を過ぎても残る場合は chrome-empire が
落ちているか、Provider の `getPostSteps()` のセレクタが実画面と
合っていない可能性があります。

```bash
docker compose logs --tail=50 chrome-empire
docker compose exec chrome-empire node -e \
  "fetch('http://127.0.0.1:4000/status').then(r=>r.json()).then(console.log)"
```

### ジョブが処理されない
`worker` が落ちていないか、Redis に到達できているかを確認します。
キューに溜まったジョブは worker が復帰すれば処理されます。

```bash
docker compose ps worker
docker compose logs --tail=50 worker
docker compose exec redis redis-cli keys 'bull:avatar-cmd-*'
```

### メモリ不足
```bash
echo "CHROME_POOL_SIZE=2" >> .env
echo "WORKER_CONCURRENCY=1" >> .env
docker compose up -d chrome-empire worker
```

---

## 回帰チェック

テストランナーは未導入で、主要な経路は tsx で直接実行するチェックスクリプト
にしてあります。DB と Redis を起動した状態で実行してください。

```bash
# SSRF防御 / パストラバーサル防御（外部依存なし）
pnpm --filter @avatar-cmd/core check:security

# スケジューラ（cron 評価・二重発火防止・予約投稿の発火）
pnpm --filter @avatar-cmd/core check:scheduler

# 投稿処理（API 失敗時の扱い・ブラウザキューへの委譲）
pnpm --filter @avatar-cmd/core check:publish

# ブラウザ操作の実行（実ブラウザが必要）
#   pnpm exec playwright install chromium
#   もしくは CHROMIUM_EXECUTABLE で既存バイナリを指定
pnpm --filter @avatar-cmd/chrome-empire check:operations
```

## 未実装 / 既知の制約

- **ブラウザのログイン手順が未接続**。`getLoginSteps()` は Provider が
  持っていますが、セッション切れを検知してログインを挟む処理がありません。
  実運用前にプラットフォームごとのセレクタの検証が必要です。
- **API 投稿のトークン更新が未実装**。`refreshToken()` は Provider に
  ありますが、期限切れ時に呼ぶ処理がありません。
- **Provider のセレクタは未検証**。`getPostSteps()` のセレクタは実際の
  画面と突き合わせていないため、そのままでは失敗する可能性があります。
- `GET /api/content` はモックデータを返します（v3 の SNS 運用画面が参照）。
  実データは `/api/posts` 側です。
- `pnpm lint` は ESLint 未設定のため実行できません。

---

## 重要ファイルパス

| ファイル | 説明 |
|---------|------|
| `README.md` | プロジェクト全体の構成と機能一覧 |
| `docker-compose.yml` | 本番用 Compose（web / worker / db / redis / chrome-empire / migrate / cloudflared） |
| `Dockerfile` | マルチステージビルド（ターゲット: `web` / `worker` / `migrator` / `chrome-empire`） |
| `.env.example` | 環境変数テンプレート |
| `apps/web/src/lib/auth.ts` | NextAuth 設定（Credentials + ロール） |
| `apps/web/src/middleware.ts` | ダッシュボードと API の保護 |
| `apps/web/src/app/api/health/route.ts` | ヘルスチェック |
| `packages/core/src/security/url-guard.ts` | SSRF 防御 |
| `packages/core/src/persona/soul-engine.ts` | Soul Engine（パス検証込み） |
| `packages/queue/src/index.ts` | BullMQ のキュー定義（web / worker / chrome-empire が共有） |
| `packages/core/src/scheduler/worker-main.ts` | worker のエントリポイント |
| `packages/core/src/scheduler/tick.ts` | cron 評価と予約投稿の発火 |
| `packages/core/src/scheduler/workers.ts` | ジョブ本体（生成 / 投稿 / ナレッジ収集） |
| `packages/chrome-empire/src/operations.ts` | BrowserOperation の実行 |
| `packages/chrome-empire/src/worker.ts` | Chrome Empire のエントリポイント |
