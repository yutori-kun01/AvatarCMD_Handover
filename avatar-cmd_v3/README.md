# Avatar CMD v3 — 統合版（v2 + v3）

複数のAIアバター（ペルソナ）が自律的にSNS運用・コンテンツ生成・ナレッジ収集を行い、人間は「ディレクター」として監督する統合管理プラットフォームです。
v3 のモノレポ／コンテナ基盤に、v2 の Gemini 生成・ファイルベース Soul Engine・ダッシュボードUI・Ghost 連携を統合しています。

---

## クイックスタート

### A. Docker Compose（推奨・本番相当）

```bash
cp .env.example .env
# 必須: DB_PASSWORD / AUTH_SECRET / ENCRYPTION_KEY / ADMIN_PASSWORD を設定
#   AUTH_SECRET:    openssl rand -base64 32
#   ENCRYPTION_KEY: openssl rand -hex 32   ← 運用開始後は変更しないこと

docker compose up -d --build                    # web + db + redis (+ migrate/seed)
docker compose --profile chrome up -d --build   # Chrome Empire ワーカーも起動する場合
```

→ http://localhost:3333 を開き、`ADMIN_EMAIL` / `ADMIN_PASSWORD` でログイン。

起動順: `db`/`redis` healthy → `migrate`（`prisma migrate deploy` + seed、完了後に終了）→ `web`。
Traefik 配下で HTTPS 公開する場合:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

### B. ローカル開発

前提: Node.js 20+ / pnpm 10 / PostgreSQL 16 / （任意）Redis 7

```bash
pnpm install

# DB 接続（Prisma CLI 用）
echo 'DATABASE_URL="postgresql://avatar:avatar@localhost:5432/avatar_cmd?schema=public"' > packages/db/.env

# Web 用
cat > apps/web/.env.local <<'EOF'
DATABASE_URL="postgresql://avatar:avatar@localhost:5432/avatar_cmd?schema=public"
AUTH_SECRET="dev-secret-change-me"
ENCRYPTION_KEY="dev-encryption-key-change-me"
REDIS_URL="redis://localhost:6379"   # 省略時はインメモリキュー
# GEMINI_API_KEY=""                  # 省略時はモック生成
EOF

pnpm db:deploy     # マイグレーション適用
pnpm db:seed       # 管理者・アバター5体・サンプルデータ・Soulファイル生成
pnpm dev:web       # http://localhost:3333
```

初期ログイン: `admin@avatar-cmd.local` / `admin1234`（`ADMIN_PASSWORD` 未設定時の開発用。本番では必ず設定）

その他:

```bash
pnpm typecheck        # 全パッケージの型チェック
pnpm test             # core の単体テスト (vitest)
pnpm worker:chrome    # Chrome Empire ワーカー（REDIS_URL 必須）
```

---

## アーキテクチャ

```
apps/web (Next.js 15 App Router)
 ├─ /                 マーケティングLP（v2から移植）  /blog → Ghost CMS
 ├─ /login            Auth.js v5（Credentials, JWT）
 ├─ /dashboard/*      ダッシュボード（要ログイン）
 ├─ /api/*            REST API（zod検証・ロール制御）
 └─ instrumentation   スケジューラ + キューワーカーをサーバープロセス内で起動

packages/core         ビジネスロジック
 ├─ ai/router         Gemini 2.5 Flash（未設定時はモック）
 ├─ persona/          Soul Engine（soul.md 等のファイル管理）/ MoodEngine
 ├─ scheduler/        Orchestrator（BullMQ or インメモリ）/ Workers / AutomationRunner
 ├─ publishing/       Publisher（integrations 経由で配信）/ Chrome Empire への委譲
 └─ security/         CredentialVault(AES-256-GCM) / SSRF Guard

packages/integrations 16 SNS Provider（API / Browser / Hybrid）
packages/chrome-empire Playwright プール + Redis ワーカー（dist/worker.js）
packages/db           Prisma スキーマ（PostgreSQL）・マイグレーション・seed
data/avatars/         Soul Engine ファイル（Docker では avatar-data ボリューム）
```

### 自律運用パイプライン

```
AutomationRule（毎N分 / cron）
   └─(Scheduler tick)→ Queue: generate_post
         └─ Soul(soul.md+identity.md+rules.md) + 最新ナレッジ + Mood → Gemini → Content(DRAFT)
              └─(autoPublish or 手動「配信」)→ Queue: publish_post
                    ├─ PUBLISH_MODE=dry-run → PUBLISHED（擬似ID）
                    └─ live → API（暗号化トークン）/ Browser → Chrome Empire → 結果をDBへ反映
ScheduledPost（予約日時到来）→ Queue: publish_due → 同上
Knowledge URL 登録 → Queue: fetch_knowledge（SSRF Guard）→ 本文抽出してナレッジ化
```

- 複数インスタンスでも二重実行しないよう、ルール・予約投稿は楽観ロックで「確保」してからジョブ投入します。
- Redis 利用時は BullMQ による永続キュー（指数バックオフ付きリトライ）。未設定時はプロセス内キュー。

---

## ダッシュボード

| パス | 内容 |
|---|---|
| `/dashboard` | KPI・エンゲージメント推移・アバター別収益・アバターカード（起動/停止・AI生成）・コラボ・改善提案・最新アクティビティ |
| `/dashboard/avatars` | 一覧／詳細、作成・編集・複製・削除、**人格ファイル（soul.md/identity.md/rules.md）エディタ**、SNSアカウント連携（トークン暗号化保存） |
| `/dashboard/sns` | 下書き/予約/配信済み、手動作成・予約・即時配信、Saga: AI自動生成、16プラットフォーム一覧 |
| `/dashboard/activity` | AI生成ログ・システムイベント（メタデータのインスペクタ付き） |
| `/dashboard/revenue` | 月次推移・収益源・アバター別・収益記録 |
| `/dashboard/collab` | アバター間コラボの提案・進行管理 |
| `/dashboard/knowledge` | ナレッジ登録（手入力 / URL自動取得） |
| `/dashboard/automation` | 自動化ルール（一定間隔 / cron、AI生成・自動配信、今すぐ実行） |
| `/dashboard/chrome` | Chrome Empire プール監視（ワーカーのハートビート） |
| `/dashboard/settings` | 一般・通知（ブラウザ保存）、**システム稼働状況**（DB/キュー/AI/投稿モード/暗号化/ワーカー） |

---

## API 一覧（すべて要ログイン。`/api/health` のみ公開）

| Endpoint | Methods | 説明 |
|---|---|---|
| `/api/avatars` | GET, POST | 一覧 / 作成（Soulファイルを初期化） |
| `/api/avatars/[id]` | GET, PATCH, DELETE | 詳細 / 更新 / 削除（Soulディレクトリも削除） |
| `/api/avatars/[id]/files` | GET, PUT | 人格ファイル読み書き（許可ファイルのみ） |
| `/api/avatars/[id]/accounts` | GET, POST | SNSアカウント（トークンは暗号化、レスポンスに含めない） |
| `/api/sns-accounts/[id]` | DELETE | 連携解除 |
| `/api/posts` | GET, POST | 投稿一覧 / 作成（`PUBLISHED`=即時配信ジョブ, `SCHEDULED`=予約） |
| `/api/posts/[id]` | GET, PATCH, DELETE | 投稿詳細 / 編集・再スケジュール / 削除 |
| `/api/posts/[id]/publish` | POST | 今すぐ配信 |
| `/api/automations` | GET, POST | ルール一覧 / 作成（v2形式 `schedule:every_30min` も受理） |
| `/api/automations/[id]` | PATCH, DELETE | 更新・有効/無効 / 削除 |
| `/api/automations/[id]/run` | POST | 今すぐ実行 |
| `/api/knowledge` | GET, POST | ナレッジ一覧 / 追加（URLはSSRF検査後に取得ジョブ） |
| `/api/knowledge/[id]` | POST, DELETE | 再取得 / 削除 |
| `/api/collaborations` `/[id]` | GET, POST, PATCH, DELETE | コラボ管理 |
| `/api/revenue` | GET, POST | 収益集計（アバター/収益源/PF/月次）/ 記録 |
| `/api/activity` | GET | アクティビティログ |
| `/api/dashboard` | GET | ダッシュボード集計 |
| `/api/platforms` | GET | 16 Provider 情報 + 連携数 |
| `/api/queue/trigger` | GET, POST | キュー状態 / ジョブ投入 |
| `/api/chrome-pool` | GET | Chrome Empire 状態 |
| `/api/system` | GET | 稼働状況 |
| `/api/health` | GET | ヘルスチェック（公開） |

ロール: `OWNER` / `ADMIN` / `OPERATOR` は読み書き可、`VIEWER` は GET のみ（403）。

---

## セキュリティ

- **認証**: Auth.js v5 Credentials（bcrypt）、JWT セッション12時間、ログイン失敗のレート制限、ログイン/失敗/資格情報変更を `audit_logs` に記録。ミドルウェアで `/dashboard`・`/api` を保護。
- **SSRF 防御**: http/https・80/443 のみ、URL埋め込み資格情報禁止、localhost/*.internal 等をブロック、**接続時の名前解決結果**を検査（DNSリバインディング対策）、リダイレクト毎に再検査、サイズ/タイムアウト上限。
- **パストラバーサル防御**: アバターIDは `[A-Za-z0-9_-]{1,64}`、ファイル名は許可リスト（soul.md/identity.md/rules.md）、解決後パスがベース配下か検査、256KB上限、原子的書き込み。
- **資格情報**: SNSトークンは AES-256-GCM（`ENCRYPTION_KEY`）で暗号化保存し、APIでは返さない。
- **入力検証**: 全APIを zod で検証（更新系 PATCH は未知フィールドを拒否）。
- **HTTPヘッダ**: X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy。

---

## 主要な環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL（Docker では自動生成） |
| `AUTH_SECRET` | — | Auth.js 署名鍵（必須） |
| `ENCRYPTION_KEY` | — | SNSトークン暗号化鍵（必須） |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin@avatar-cmd.local / admin1234 | seed で作成する管理者 |
| `REDIS_URL` | 未設定=インメモリ | BullMQ キュー / Chrome Empire 連携 |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | 未設定=モック / gemini-2.5-flash | AI生成 |
| `PUBLISH_MODE` | `dry-run` | `live` で実際にSNSへ配信 |
| `SCHEDULER_TICK_MS` | 30000 | 自動化ルール評価間隔 |
| `RUN_SCHEDULER` / `RUN_WORKER` | true | `false` でプロセス内スケジューラ/ワーカーを無効化 |
| `AVATAR_DATA_DIR` | `<repo>/data/avatars` | Soul Engine の保存先 |
| `GHOST_URL` / `GHOST_CONTENT_API_KEY` | 未設定=空ブログ | マーケティングブログ |
| `CHROME_POOL_SIZE` | 3 | ブラウザインスタンス上限 |

---

## 運用メモ・既知の制約

- **本番配信（`PUBLISH_MODE=live`）**: API対応PFはアバター詳細 > 設定タブでアクセストークンを登録すると API で投稿します。ブラウザ専用PF（note/Zenn 等）は Chrome Empire に委譲され、プロファイルにログイン済みセッション（storageState）が必要です（ログイン自動化は行いません）。各プラットフォームの利用規約に従って運用してください。
- **OAuth フロー**（X/YouTube 等の認可画面連携）は未実装です。現状はトークンを手動登録します。
- ContentService / CampaignService / AnalyticsService などの旧インメモリサービスは `@avatar-cmd/core` に残していますが、Web は Prisma を直接利用しています。
- `Avater_CMD_v2/` は移植元として参照用に残しています（ビルド対象外）。
