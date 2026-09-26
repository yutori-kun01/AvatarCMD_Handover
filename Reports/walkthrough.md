# Avatar CMD 統合開発 Walkthrough

## 1. 実施概要
本ウォークスルーは、V2 (Next.js プロトタイプ) と V3 (モノレポ・コンテナアーキテクチャ) の統合に関する **Phase 1 (基盤統合) および Phase 2 (フロントエンド基盤構築)** の初期実装完了報告です。

## 2. 実施された変更詳細

### 2.1 Prisma データベーススキーマの完全統合
V3 の `packages/db/prisma/schema.prisma` に対し、V2 の不足していた要素をマージしました。
- `Avatar` モデルへの V2 フィールド (`specialization`, `targetAudience`, `avatarImageUrl`, `lastSyncAt`) の追加。
- `Collaboration` モデルの新規追加とリレーション設定。
- `@avatar-cmd/db` への `db:generate` の実行（正常完了・クライアント更新済み）。

### 2.2 V2 コアモジュールの V3 `packages/core` への移植
以下の V2 独自のAIおよび自律運用ロジックを、V3 のサービス層（`packages/core`）に移植しました。
- **AI Router** (`ai/router.ts`): Gemini 2.5 Flash を用いた投稿自動生成ロジック。
- **Soul Engine** (`persona/soul-engine.ts`): アバターの `soul.md`, `identity.md`, `rules.md` のファイル管理モジュール。コンテナ運用を見据え、環境変数 `AVATAR_DATA_DIR` からのボリュームマウント対応を追加。
- **Orchestrator & Workers** (`scheduler/orchestrator.ts`, `workers.ts`): バックグラウンドでのAI生成・ナレッジスクレイピング処理。V3 の `ActivityLog`, `Content` モデルに合わせたデータアクセスへの書き換え。
- `packages/core/src/index.ts` のエクスポート解決および `@google/genai` パッケージのインストール。

### 2.3 フロントエンド基盤の再構築
Next.js App Router (`apps/web`) のルーティング構造を、マーケティングLPとダッシュボードが共存できるよう再配置しました。
- 既存の `page.tsx` や各機能を `(dashboard)/` 配下に移動。
- V2 のサービスLPやブログ群を `(marketing)/` 配下にコピー。
- V2 の `components/marketing` のコピー。

## 3. 次のステップ
基盤のデータモデルと主要なAIコアロジックの統合は完了しました。
フロントエンドはルーティングを分離した段階であり、この後UIコンポーネント群の完全なマージとビルドエラーの解消（Phase 2 後半）を継続する必要があります。

**この状態で、UI/UX の確認や運用マニュアル生成プロセス（`/docsnap`）へ移行可能です。**

---

# 追記: Phase 2 後半〜Phase 4 完了報告（統合実装・稼働確認）

## 1. 実施概要
v2 の機能を v3 モノレポに統合し、**ローカル実行と Docker Compose の双方で稼働確認まで完了**しました。詳細な使い方は `avatar-cmd_v3/README.md` を参照してください。

## 2. 主な実装
| 領域 | 内容 |
|---|---|
| 基盤 | `pnpm-workspace.yaml`・ルート `tsconfig.json` 追加、lockfile 固定、Prisma 初期マイグレーション（PostgreSQL） |
| DB | `Avatar.tone` 追加・インデックス追加。seed を冪等化し、管理者（bcrypt）・アバター5体・SNSアカウント・投稿・収益6か月・分析30日・自動化・ナレッジ・コラボ・改善提案・Soulファイルを生成 |
| Core | Orchestrator（Redis=BullMQ / 未設定=インメモリ）、AutomationRunner（一定間隔・cron・v2形式トリガー、楽観ロックで二重実行防止）、Workers（Soul+ナレッジ+MoodEngine→Gemini生成、配信、SSRF安全なナレッジ取得、メンテナンス）、Publisher（dry-run / live、暗号化トークンでAPI投稿、ブラウザPFは Chrome Empire へ委譲）|
| Web | ルーティングを `/`（LP）・`/blog`・`/login`・`/dashboard/*` に整理。v2 UI（アバター/人格エディタ/SNS/収益/コラボ/ナレッジ/自動化/設定）を実APIに接続、ダッシュボード概要・Chrome Empire 画面を新規作成。モックAPIを全て DB 実装に置換 |
| 認証 | Auth.js v5 Credentials + ミドルウェア保護、ロール制御（VIEWER は読み取りのみ）、監査ログ |
| セキュリティ | SSRF Guard（接続時IP検査・リダイレクト再検査）、Soul Engine パストラバーサル防御、AES-256-GCM、zod 検証、セキュリティヘッダ |
| Chrome Empire | Redis ワーカー（`dist/worker.js`）実装、BrowserOperation ステップ実行、プール状態のハートビート、セッション保存バグ修正 |
| インフラ | Dockerfile（web / migrator / chrome の3ターゲット、非root実行、ヘルスチェック）、compose（migrate→web の起動順、avatar-data ボリューム、Traefik は override に分離） |

## 3. 検証結果
- `pnpm typecheck`（6パッケージ）成功、`pnpm test`（core 52件）成功、`next build` 成功
- API E2E: ログイン → AI生成 → 配信（dry-run）→ 重複配信409、予約投稿の自動公開、自動化ルール作成/手動実行/自動配信、収益記録、コラボ、アバター作成/削除（Soulディレクトリ連動）、SNSトークン暗号化保存、VIEWER の書き込み403
- セキュリティ: `127.0.0.1` / `169.254.169.254` / `file://` / `localhost` のナレッジURLを拒否、`../../etc/passwd` 等の人格ファイル操作を拒否
- ブラウザ配信: live モードで Chrome Empire ワーカーへ委譲 → Playwright 実行 → 結果が投稿ステータスに反映されることを確認
- UI: Playwright で全ダッシュボード画面を巡回し、コンソールエラー・5xx なし
- Docker: `docker compose --profile chrome up` で db/redis/migrate/web/chrome が起動、seed・ボリューム権限・再起動後の永続化・ログイン後のディープリンク復帰を確認

## 4. 残課題（次フェーズ候補）
- SNS OAuth 認可フロー（現状はトークン手動登録）
- ブラウザ専用PFのログインセッション作成手順の整備
- 改善提案（ImprovementCycle）の自動生成ジョブ化、実SNSからのメトリクス収集
- VPS へのデプロイ（Traefik override 利用）
