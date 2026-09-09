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

## VPSデプロイ手順

> 対象VPS: Xserver VPS (AMD EPYC 6-core, 12GB RAM, Ubuntu 22.04, Traefik + Portainer稼働中)

### Step 1: プロジェクト転送

```bash
# ローカルからVPSへプロジェクトを転送 (rsyncまたはscp)
rsync -avz --exclude node_modules --exclude .next \
  /c/Users/retim/Desktop/OpenClaw/01_開発/avatar-cmd/ \
  user@vps:/opt/avatar-cmd/
```

### Step 2: Docker Compose で起動

`docker-compose.yml` をプロジェクトルートに作成（後述の docker-compose.yml 参照）。

```bash
ssh user@vps
cd /opt/avatar-cmd
cp .env.example .env
# .env を編集（DB接続先、APIキー等）
docker compose up -d
```

### Step 3: Traefik連携

既存のTraefikネットワークに接続する場合は、docker-compose.yml内の `traefik-net` を既存のネットワーク名に変更。

---

## 環境変数 (.env)

```bash
# --- Database ---
DATABASE_URL=postgresql://avatar:password@db:5432/avatar_cmd
REDIS_URL=redis://redis:6379

# --- Security ---
MASTER_KEY=<your-master-key-here>
NEXTAUTH_SECRET=<nextauth-secret>
NEXTAUTH_URL=https://avatar-cmd.your-domain.com

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
