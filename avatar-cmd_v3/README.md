# Avatar CMD v3 — プロジェクト概要 & 引き継ぎドキュメント

> **別ウィンドウ / 別セッション** でも開発を継続できるようにした完全なリファレンスです。

---

## クイックスタート（ローカル開発）

```bash
cd C:\Users\retim\Desktop\OpenClaw\01_開発\avatar-cmd

# 依存パッケージインストール
pnpm install

# 開発サーバー起動 (port 3333)
cd apps/web && npx next dev --port 3333
```

---

## プロジェクト構成

```
avatar-cmd/
├── apps/web/                       # Next.js 15 Dashboard (port 3333)
│   └── src/
│       ├── app/
│       │   ├── page.tsx            # ダッシュボード（KPI + アバターカード）
│       │   ├── avatars/page.tsx    # アバター管理（リスト/詳細 + ペルソナ）
│       │   ├── activity/page.tsx   # パフォーマンス分析 & 改善提案
│       │   ├── sns/page.tsx        # SNS運用（16プラットフォーム/コンテンツ/キャンペーン）
│       │   ├── revenue/page.tsx    # 収益分析（月次推移/収益源/アバター別）
│       │   ├── automation/page.tsx # 自動化ルール（7ルール + トグルスイッチ）
│       │   ├── settings/page.tsx   # 設定（一般/セキュリティ/API/スケジューラ/通知）
│       │   └── api/
│       │       ├── chrome-pool/route.ts   # Chrome Empire Pool Status
│       │       ├── platforms/route.ts     # 16 SNS Platforms (GET → JSON)
│       │       ├── content/route.ts       # Content & Campaigns
│       │       ├── analytics/route.ts     # KPI & Performance Data
│       │       └── revenue/route.ts       # Revenue Reports
│       ├── components/
│       │   └── dashboard/
│       │       ├── sidebar.tsx     # Link-based routing (usePathname)
│       │       └── header.tsx      # Auto title/desc by pathname
│       └── lib/
│           └── utils.ts            # cn() helper
│
├── packages/
│   ├── db/                         # Prisma ORM (15 models)
│   │   ├── prisma/schema.prisma
│   │   └── src/index.ts
│   │
│   ├── core/                       # 7 Business Logic Services
│   │   └── src/
│   │       ├── index.ts            # Public API (全エクスポート)
│   │       ├── persona/mood-engine.ts       # MoodEngine
│   │       ├── avatar/avatar-service.ts     # AvatarService
│   │       ├── security/credential-vault.ts # CredentialVault (AES-256-GCM)
│   │       ├── content/content-service.ts   # ContentService (生成/キュー/A-B)
│   │       ├── content/campaign-service.ts  # CampaignService (企画/目標)
│   │       ├── analytics/analytics-service.ts    # AnalyticsService (KPI/インサイト)
│   │       ├── analytics/improvement-engine.ts   # ImprovementEngine (改善サイクル)
│   │       ├── analytics/revenue-service.ts      # RevenueService (収益追跡)
│   │       └── scheduler/scheduler-service.ts    # SchedulerService (投稿スケジューラ)
│   │
│   ├── chrome-empire/              # Playwright Browser Pool
│   │   └── src/
│   │       ├── pool.ts             # ChromeEmpire (spawn/destroy/health)
│   │       ├── profile.ts          # ProfileManager (fingerprint isolation)
│   │       ├── types.ts            # ChromeInstance, BrowserTask, etc.
│   │       └── index.ts
│   │
│   └── integrations/               # 16 SNS Providers + Registry
│       └── src/
│           ├── provider.ts         # SnsProvider interface (dual-mode)
│           ├── registry.ts         # ProviderRegistry (rate limiting)
│           ├── providers/
│           │   ├── base.ts         # BaseProvider (auto API→Browser fallback)
│           │   ├── x.ts            # X (Twitter) — hybrid
│           │   ├── note.ts         # note.com — browser only
│           │   └── platforms.ts    # 残り14プラットフォーム
│           └── index.ts            # createDefaultRegistry()
│
├── package.json                    # Root (pnpm workspace)
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

---

## 実装済み機能一覧

### Phase 0: モノレポ基盤 + UI移植 ✅
- Turborepo + pnpm workspaces
- Next.js 15 + Tailwind CSS + shadcn/ui
- Prisma 15 models (Avatar, SnsAccount, Content, Campaign, Revenue, etc.)
- オリジナルAvatar CMD v2のダークテーマUI完全再現

### Phase 1: Chrome Empire MVP ✅
- Playwright browser instance pool (spawn/destroy/task execution)
- Session persistence via storageState
- Profile isolation per avatar (UA, viewport, timezone)
- Health monitoring + auto-recovery
- Stealth mode (anti-detection)

### Phase 2: SNS 16プラットフォーム デュアルモード ✅

| Category | Platforms | Auth |
|----------|-----------|------|
| **Hybrid (API+Browser)** | X, Threads, Instagram, YouTube, Facebook, LinkedIn, Reddit | OAuth |
| **API Primary** | Bluesky (AT Protocol), WordPress (REST v2) | App Password / API Key |
| **Browser Only** | note, TikTok, Zenn, Medium, Substack, Ameba Blog, stand.fm | Session |

- `BaseProvider`: 自動モード選択（API優先 → Browser fallback）
- `BrowserOperation[]`: Chrome Empireが実行するステップ定義
- スクレイピングではなくPlaywright操作によるBAN回避

### Phase 3: ContentService + CampaignService ✅
- Content lifecycle: draft → scheduled → queued → publishing → published/failed
- A/B test variant creation
- Campaign: draft → active → paused → completed
- Goal tracking + metrics aggregation

### Phase 4: AnalyticsService + ImprovementEngine ✅
- KPI calculation (7-day comparison)
- Auto-generated insights with recommendations (JP)
- Improvement cycle: analyze → suggest → apply → measure impact

### Phase 5: RevenueService ✅
- Multi-source revenue tracking (affiliate, paid_content, sponsorship, donation, ad, subscription, merchandise)
- Reports by avatar / source / platform / monthly / top content

### Phase 6: SchedulerService ✅
- Job registration with frequency (once/hourly/daily/weekly/cron)
- Exponential backoff retry (4^n minutes)
- Auto-disable after max retries
- Background loop (30s tick)

### Phase 7: 全ダッシュボードUI ✅
- 7 pages with Link-based routing
- Dark theme consistent across all pages

---

## 技術スタック

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 + React 19 + Tailwind CSS + shadcn/ui |
| Package Manager | pnpm + Turborepo |
| ORM | Prisma |
| Browser Automation | Playwright |
| Encryption | AES-256-GCM (CredentialVault) |
| API Auth | OAuth 2.0 PKCE / AT Protocol / Session |

---

## デプロイ

公開経路は **Cloudflare Tunnel**。VPS 側で 80/443 は開けず、`cloudflared`
コンテナが Cloudflare エッジへ外向き接続を張り、内部ネットワーク越しに
`web:3000` へ転送します。TLS 終端と証明書は Cloudflare 側が担うため
Traefik と Let's Encrypt は使いません。

手順の詳細は **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照してください。
Cloudflare 側の設定、必須の環境変数、初期管理者の作成、バックアップ、
トラブルシューティング、未実装の制約までそちらにまとめてあります。

```bash
# 概要のみ
cp .env.example .env     # TUNNEL_TOKEN / AUTH_SECRET / AUTH_URL / DB_PASSWORD を設定
docker compose build
docker compose up -d     # db → migrate → web → cloudflared の順に起動
```

### Compose のサービス構成

| サービス | 役割 | 外部公開 |
|---------|------|---------|
| `cloudflared` | Cloudflare Tunnel のコネクタ | 外向き接続のみ |
| `web` | Next.js ダッシュボード / API（ジョブは投入のみ） | なし（tunnel 経由） |
| `worker` | アプリジョブの処理（AI生成 / ナレッジ収集） | なし |
| `migrate` | `prisma migrate deploy`（ワンショット） | なし |
| `db` | PostgreSQL 16 | なし |
| `redis` | BullMQ ジョブキュー + キャッシュ | なし |
| `chrome-empire` | Playwright ワーカー（ブラウザ操作） | なし |

### Docker イメージのターゲット

`Dockerfile` はマルチステージで 3 つのターゲットを持ちます。

- `web` … Next.js standalone + Prisma のクエリエンジン
- `worker` … アプリジョブキューの消費（tsx で TS を直接実行）
- `migrator` … マイグレーションとシード実行用
- `chrome-empire` … Playwright ブラウザ同梱イメージ上のワーカー（単一CJSにバンドル）

### ジョブキュー

`web` はジョブを Redis (BullMQ) に投入するだけで処理しません。
処理は `worker`（AI生成・ナレッジ収集）と `chrome-empire`（ブラウザ操作）が行います。
このため web を再起動しても未処理ジョブは失われず、web を複数レプリカにできます。

| キュー | 投入 | 消費 |
|-------|------|------|
| `avatar-cmd-jobs` | web (`/api/queue/trigger`, `/api/knowledge`)、worker の tick | `worker` |
| `avatar-cmd-browser` | worker (`publish_post` がブラウザ投稿に回した場合) | `chrome-empire` |

### 自律運用の流れ

`worker` が既定30秒ごとに tick を回し、`AutomationRule` の cron と
期限が来た `ScheduledPost` を評価してジョブを投入します。

```
tick ─┬─ AutomationRule (cron)  ──► generate_post
      └─ 期限切れ ScheduledPost ──► publish_post

generate_post → Soul Engine の人格 + 最近のナレッジを Gemini に注入
                 → Content を DRAFT で保存
publish_post  → Provider の API 投稿を試す
                 ├─ 成功        → Content を PUBLISHED に
                 └─ ブラウザ必要 → ブラウザキューへ操作列を投入
                                    → chrome-empire が Playwright で実行
```

`actionType` の対応は `post` / `generate` → `generate_post`、
`publish` → `publish_post`、`scrape` / `knowledge` → `fetch_knowledge`。

---

## 環境変数 (.env)

```bash
# --- Database ---
DATABASE_URL=postgresql://avatar:password@db:5432/avatar_cmd
REDIS_URL=redis://redis:6379

# --- Security ---
MASTER_KEY=<your-master-key-here>
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=https://avatar-cmd.your-domain.com

# --- Cloudflare Tunnel ---
TUNNEL_TOKEN=<Zero Trust で発行したコネクタトークン>

# --- SNS API Keys (暗号化して保存するため、初期設定のみ) ---
X_CLIENT_ID=
X_CLIENT_SECRET=
THREADS_APP_ID=
YOUTUBE_API_KEY=
FACEBOOK_APP_ID=

# --- Chrome Empire ---
CHROME_POOL_SIZE=3
CHROME_HEADLESS=true
CHROME_STEALTH=true

# --- Scheduler ---
SCHEDULER_TICK_MS=30000
SCHEDULER_MAX_RETRIES=3
```

---

## API一覧

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/platforms` | GET | 16 SNSプラットフォーム情報 + modes |
| `/api/content` | GET | コンテンツ統計 + キャンペーン情報 |
| `/api/analytics` | GET | KPI + アバターパフォーマンス + 改善提案 |
| `/api/revenue` | GET | 収益レポート (by avatar/source/platform/monthly) |
| `/api/chrome-pool` | GET | Chrome Empire Pool ステータス |

---

## 今後の拡張ステップ

1. **Prismaマイグレーション**: mock data → PostgreSQL 実データ接続
2. **Chrome Empire実稼働**: Playwright実インスタンス起動 + VPSでのheadless動作テスト
3. **OAuth実装**: X / YouTube / Facebook の実OAuth 2.0フロー
4. **ブラウザセッション**: note / TikTok / Zenn の自動ログイン
5. **マルチテナント**: Schema分離によるSaaS化
6. **LLM統合**: Ollama / Claude API 接続 (現在はLLM不使用方針)
