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
