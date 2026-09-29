# Avatar CMD v3 — プロジェクト概要 & 引き継ぎドキュメント

> **別ウィンドウ / 別セッション** でも開発を継続できるようにした完全なリファレンスです。

---

## クイックスタート

### 本番（VPS / Docker Compose）

```bash
cd avatar-cmd_v3
bash scripts/setup-env.sh https://avatar-cmd.example.com   # .env を自動生成（管理者パスワードが表示される）
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build   # Traefik 経由
# または: docker compose up -d --build                                             # ポート 3333 で公開
```

詳しい手順・SNSごとの開発者ポータル設定は **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照。

### ローカル開発

```bash
cd avatar-cmd_v3
pnpm install
bash scripts/setup-env.sh http://localhost:3333   # DATABASE_URL はローカルの PostgreSQL に合わせて編集
pnpm db:deploy                                    # マイグレーション適用
pnpm dev                                          # web (http://localhost:3333) + worker を起動
pnpm test                                         # SNS 連携のリクエスト形状テスト
```

### 設定の考え方

`.env` に置くのは起動に必要な値（DB・暗号鍵・管理者パスワード・公開URL）だけです。
**SNS の Client ID / Secret、トークン、アプリパスワード、ログインCookie、AI（Claude / OpenAI / Gemini）の API キーは
すべてダッシュボードの「設定」画面から入力**し、AES-256-GCM で暗号化して DB に保存されます。

| 画面 | できること |
|---|---|
| 設定 > SNS連携アプリ | 各SNSの開発者アプリ情報を登録。登録すべきリダイレクトURIと手順・公式ドキュメントへのリンクを表示 |
| 設定 > アカウント | アバターごとに SNS アカウントを接続（OAuth / アプリパスワード / トークン / Cookie）、投稿設定、認証情報の確認・今すぐ更新・差し替え、アバター専用の開発者アプリ |
| 設定 > システム | 公開URL、Meta Graph API / LinkedIn API のバージョン、AI の API キーと用途ごとのプロバイダ・モデル |
| 設定 > セキュリティ | 管理者パスワード変更、ログアウト |
| 投稿 | 投稿先を選んで本文・画像・動画を投稿／予約。AI で下書き生成。送信状況・エラー・再送・下書きの承認 |
| ダッシュボード | 投稿数・成功率・予約/承認待ち・収益、worker 稼働状況、対応が必要なこと（すべて DB の実データ） |
| アバター管理 | アバターの作成・編集・一時停止・削除、ペルソナ（AI 生成に使用） |
| 自動化ルール | 毎日の時刻 or 一定間隔で AI が投稿文を生成し、下書き（承認制）または自動投稿 |
| アクティビティ / SNS運用 / 収益分析 | 実行ログ、プラットフォーム別の接続・投稿状況、収益の記録と集計 |

### X / Threads の本文の整形

- 200文字以内: 改行を取り除いて1件で投稿します。
- 200文字超: アカウントの投稿設定「200文字を超える投稿」で、**改行ありで1件** か **ツリー型（200文字以内ずつ返信でつなぐ）** を選べます。
- 1件の上限（X は 280＝日本語 約140文字、Threads は 500文字）を超える場合は、どちらの設定でも自動でツリーに分けます。
  X Premium のアカウントは投稿設定「X Premium」を「あり」にすると長文を1件で投稿できます。
- Threads のツリー投稿には `threads_manage_replies` 権限が必要です（追加前に接続したアカウントは再接続してください）。

### 複数アバターで別々の X / Threads アカウントを使う

アバターごとに「アバター専用の開発者アプリ」を登録すると、そのアバターの接続・トークン更新・投稿はそのアプリで行われます（未登録なら共通アプリ）。
2つ目以降のアカウントを接続するときは、**ブラウザの X / Threads を接続したいアカウントにログインし直してから**「接続」を押してください
（ログイン中のアカウントで認可されるため、そのままだと1つ目と同じアカウントがつながります。重複した場合は接続時に警告が出ます）。
X API の従量課金クレジットは開発者アカウントごとなので、専用アプリの開発者アカウント側にもクレジットが必要です。

### 対応状況（2026年9月時点の公式仕様に準拠）

| SNS | 方式 | 投稿API |
|---|---|---|
| X | OAuth 2.0 + PKCE | `POST api.x.com/2/tweets`、メディアは `/2/media/upload`（v2） |
| Threads | OAuth（長期トークン自動更新） | `graph.threads.net/v1.0` コンテナ → `threads_publish` |
| Instagram | Instagram ログイン（長期トークン自動更新） | `graph.instagram.com/v26.0` コンテナ → `media_publish` |
| Facebook ページ | Facebook ログイン | Graph API v26.0 `/{page}/feed` `/photos` `/videos` |
| YouTube | Google OAuth + PKCE | Data API v3 `videos.insert`（再開可能アップロード） |
| TikTok | Login Kit v2 | Content Posting API（Direct Post, FILE_UPLOAD） |
| LinkedIn | OAuth（OpenID Connect） | Posts API `/rest/posts`（LinkedIn-Version ヘッダ） |
| Reddit | OAuth（永続） | `/api/submit`（要 Responsible Builder Policy 承認） |
| Bluesky | アプリパスワード | 公式SDK `@atproto/api` |
| WordPress | アプリケーションパスワード | REST API v2 |
| Zenn | GitHub 連携リポジトリ | GitHub Contents API で `articles/*.md` を作成 |
| note | ログインCookie | 非公式・**下書き保存のみ** |
| Medium | 既存 Integration token | API v1（新規発行終了） |
| Substack / Amebaブログ / stand.fm | — | 公開APIが無いため自動投稿非対応 |

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
│   └── integrations/               # SNS連携（公式API準拠）+ 投稿サービス
│       ├── src/platforms/*.ts      # 1SNS = 1ファイル（認可URL・トークン交換・更新・投稿）
│       ├── src/service/            # 暗号化設定ストア・アカウント・OAuth・メディア・投稿キュー
│       └── test/                   # fetch をモックしたリクエスト形状テスト
│
├── apps/worker/                    # 予約投稿キューを処理する常駐プロセス
├── scripts/setup-env.sh            # .env 自動生成
├── docker-compose.yml              # db / migrate / web / worker
├── docker-compose.traefik.yml      # 既存 Traefik 連携用オーバーライド
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

### Phase 2: SNS 16プラットフォーム連携 ✅（v3.1 で公式API準拠に作り直し）
- 1SNS=1定義（`packages/integrations/src/platforms`）。対応状況は上の「対応状況」表を参照
- 旧実装のブラウザ操作フォールバック（セレクタ依存・ToS 上のリスク）は廃止し、公式APIに一本化
- 公式APIが無い note は Cookie を使った下書き保存まで、Substack / Ameba / stand.fm は非対応と明示

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

### Phase 9: 全画面の実データ化・AI 自動化 ✅（v3.1）
- ダッシュボード / アバター / 自動化 / アクティビティ / SNS運用 / 収益 をモックから DB 実データに置き換え
- 自動化ルール: worker がスケジュール実行し、Gemini（既定 gemini-3.8-flash、設定で変更可）で投稿文を生成
  （v3.2 で Claude / OpenAI / Gemini を用途ごとに切り替え可能に。用途: SNS投稿文・長文記事・文字数調整・投稿前チェック・タグ提案。
  自動投稿は投稿前チェックを通過したものだけ）
- UI のアイコンを Font Awesome 7 Free に統一（SNS プラットフォームのロゴなど）
- 判定レイヤー（TypeSafe Jev）: 投稿の可否・引用候補・改善か継続かを確率付きで判定（キー未設定なら従来の流れ）。
  X / Threads の投稿の反応を自動取得し、自動化ルールごとに改善か継続かを提案。X のタイムラインから引用投稿の下書きを作成（承認制）。
  詳細は [docs/JEV_DECISION_LAYER.md](docs/JEV_DECISION_LAYER.md)
- CI（GitHub Actions）: 型チェック・テスト・Next.js ビルド・Docker ビルド

### Phase 8: 設定画面・投稿キュー・本番デプロイ ✅（v3.1）
- 管理者ログイン（署名付きCookie）、設定画面から開発者アプリ/アカウント/システム設定を入力（暗号化保存）
- OAuth（PKCE・state 検証）、トークン自動更新、投稿キュー（worker・指数バックオフ再試行・二重投稿防止）
- Docker Compose（migrate → web + worker）、`scripts/setup-env.sh`、pnpm-lock.yaml をコミット

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

## デプロイ・環境変数

[docs/DEPLOY.md](docs/DEPLOY.md) と [.env.example](.env.example) を参照。

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

1. **エンゲージメント取得**: 各SNSのインサイトAPIで投稿後の反応（いいね・表示回数）を取得して分析画面に反映
2. **知識ベース画面**: KnowledgeItem は AI 生成の参考情報として使われるが、登録画面は未実装
3. **マルチテナント**: Schema分離によるSaaS化
