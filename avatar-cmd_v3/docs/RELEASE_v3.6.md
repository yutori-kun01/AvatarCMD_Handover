# v3.6 リリースノート — 変更点・未検証事項・DB 移行・ロールバック

対象ブランチ: `claude/gracious-shannon-ux99uq`（ベース: main `9e6745c`）
計画: [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md) ／ 外部 AI 用 API: [API_V1.md](API_V1.md)

> ここに書いた動作確認は、ローカルの使い捨て PostgreSQL と外部 API のモックによるものです。
> **本番環境の設定・ログ・稼働バージョンは確認していません。** 実際の SNS への投稿・API キーの発行・本番 DB の移行は行っていません。

## 1. 変更点

### ① 投稿制御（自動化ルール）
| 項目 | 変更前 | 変更後 |
|---|---|---|
| 自動承認の範囲が未指定・不正な既存ルール | 実行時に `all` 扱い | マイグレーションで `all` を**明示保存**（動作は同じ）。画面で「全自動」を警告色で表示 |
| 新規作成・編集 | 初期値 `all` | **選択必須**（下書きモードから自動投稿へ切り替えるときも選び直す） |
| 判定障害（投稿前チェックの失敗・gate モードの Jev の失敗） | standard は投稿、strict は Jev 失敗時にチェック OK なら投稿 | standard / strict では**下書きに保留**（all は従来どおり投稿） |
| ルール停止・承認条件の変更 | 既存の予約はそのまま送信 | 送信直前に再確認し、ルール停止・削除・下書きモード化・承認範囲の厳格化・アカウント停止・アバター停止なら**下書きに戻す**（人が承認した投稿はルールの状態を見ない） |
| ルール停止時 | — | 自動承認済みの予約の件数・内容を表示し、「予約も止める（下書きに戻す）／残す」を選べる |
| 下書きの理由 | チェック結果のみ | 「下書きモードで作成」「自動投稿ルールで保留（理由）」「送信直前の確認で保留（理由）」を表示 |

**ご報告いただいた「下書き→自動投稿に編集しても承認制のまま」について:** 現在の main のコードでは、編集内容は保存され、次回の実行から自動投稿として予約キューに入ることを実 DB のテストで確認しました（`test/rule-edit.test.ts`）。考えられる原因は次の3つで、本番を見ないと切り分けられません。
1. 本番が「自動承認の範囲」追加前（`49563fa` より前）の版で、自動投稿でも投稿前チェックが「問題なし」以外なら下書きになっていた
2. 自動承認の範囲が「NGのみ保留」「OKのみ投稿」で、チェック・Jev の結果により下書きに回っていた
3. 編集前に作られた下書きが残っていた

今回の変更で、下書きごとに「どのモードで・なぜ下書きになったか」が表示されるので、本番反映後はどれに当たるかを画面で確認できます。

### ② 外部 AI 用 API（`/api/v1`）と API コスト
- API キー（権限 read / draft / publish / rules:write / knowledge:write、アバターの限定、有効期限・失効）、監査ログ、レート制限、Idempotency-Key による二重実行防止。**設定 > 外部AI API**
- 使用量の共通台帳（LLM・Jev・X の読み取り／投稿・YouTube のクォータ）と料金表。**API コスト** 画面に「設定からの月額試算／今月の実績（概算）／月末予測」「ルールごとの増分」を分けて表示。単価未登録は「未算定」
- 予算: 上限到達時に「警告のみ」か「新規の生成・探索を止める」かを選択（予約済み投稿の送信は止めない）

### ③ ナレッジ・改善処理
- ナレッジに種別（出典付きの事実／人格・文体／成果からの学び）・状態・出典取得日時・適用範囲・版・根拠を追加。編集・無効化・差し戻し（履歴）。**ナレッジ・改善** 画面
- 生成時は投稿テーマに関連するナレッジを検索して使う（従来は更新順の5件）。資料として区切り、中の指示には従わせない
- 改善処理: アバターごとに 14〜27 日のランダム間隔。初期モードは**提案のみ**（承認後に適用・自動適用も選択可）

### ④ X 引用投稿
- X の引用は、最初から**元投稿の URL を本文に入れる**方式（`quote_tweet_id` と、拒否後の切り替え処理は廃止）。URL は正規化して1回だけ、前後に半角スペース
- 自動化ルール「X の引用投稿」: 読み取り件数・上限・対象期間・同じ相手の間隔・除外する相手・アバター間の再利用・承認方法を設定。既定は下書き（承認制）

### ⑤ YouTube 学習
- 自分・他の人のチャンネルを登録し、新動画を検知 → 本文（自分: 字幕 API／他の人: 提供された文字起こし）→ 根拠付き要約 → ナレッジ。**YouTube 学習** 画面
- 本文が無い動画は「本文待ち／取得不可」のまま要約しない

## 2. 未検証事項（本番反映前・反映後に確認が必要）

| 項目 | 内容 |
|---|---|
| 本番の状態 | 稼働バージョン、既存ルールの自動承認の範囲、Jev のモード、引用の自動探索の設定 |
| X の引用表示 | URL を本文に入れた投稿が、X 上で引用カードとして表示されるか。末尾の半角スペースが X 側で保持されるか（送信する本文には入っていることをテストで確認済み） |
| X の規約 | 引用ルールの「自動投稿」が X の自動化ルールに沿うか（既定は下書き・承認制。画面に警告を表示） |
| YouTube の字幕 API | 接続済みの YouTube アカウントで `captions.list / download` が使えるか（`youtube.force-ssl` 権限での再接続が必要な可能性。現状の接続スコープは変更していません） |
| 各社の usage の形式 | Claude / OpenAI / Gemini / TypeSafe の実際の応答の usage が想定どおりに記録されるか（モックで確認） |
| 料金 | 料金表は空の状態で始まります。各社の料金ページを確認して登録するまで費用は「未算定」です |
| 画面 | 新しい画面（API コスト・ナレッジ・改善・YouTube 学習・外部AI API）はビルドと型チェックのみで、ブラウザでの操作確認はしていません |

## 3. DB 移行（すべて追加のみ。既存の列の削除・型変更はありません）

| マイグレーション | 内容 |
|---|---|
| `20261003000000_automation_explicit_approval` | 自動投稿で承認範囲が未指定・不正なルールに `approval: "all"` を保存（データ更新のみ） |
| `20261003025431_usage_ledger_price_table` | `usage_ledger`, `price_entries` |
| `20261003030248_api_keys` | `api_keys`, `api_audit_logs`, `idempotency_records`, `api_rate_counters` |
| `20261003040000_knowledge_v2_improvement_schedule` | `knowledge_items` に列追加（既定値付き）・`knowledge_revisions`・`improvement_cycles` に列と一意制約・`improvement_schedules`。無効化済みのナレッジは `status=disabled` に揃える |
| `20261003050000_youtube_learning` | `youtube_channels`, `youtube_videos` |

### 反映手順（VPS / Docker Compose。実行前に確認をお願いします）

```bash
cd /opt/avatar-cmd-src/avatar-cmd_v3
# 1. バックアップ（必須）
docker compose exec db pg_dump -U avatar avatar_cmd > backup_before_v3.6_$(date +%Y%m%d%H%M).sql
# 2. 取得（main にマージ後）
git fetch && git checkout main && git pull
# 3. 再ビルド・起動（migrate コンテナが上のマイグレーションを自動で適用してから web / worker が起動）
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
# 4. 確認
docker compose ps                    # migrate が exited (0)
docker compose logs migrate | tail   # "All migrations have been successfully applied"
docker compose logs -f worker        # "[worker] started"
```

反映後の確認（実投稿はしない）:
1. 自動化ルール画面で、各ルールのバッジ（全自動／NGのみ保留／OKのみ投稿）が意図どおりか
2. 投稿画面の下書きに「なぜ下書きになったか」が表示されるか
3. API コスト画面が開けるか（料金表は空なので「未算定」になるのが正常）
4. 外部 AI API のキーは、必要になった時点で発行（権限は read / draft から）

追加の環境変数は不要です（任意: `API_KEY_PEPPER` で API キーのハッシュ鍵を `ENCRYPTION_KEY` と分けられます。**発行後に変えると既存のキーは使えなくなります**）。

## 4. ロールバック

### アプリだけ戻す（推奨。DB はそのまま）
追加したテーブル・列は旧版のコードから参照されないため、旧版のイメージでそのまま動きます。

```bash
git checkout 9e6745c   # 反映前のコミット
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

- 戻した後は、旧版の動作（自動承認の範囲 all の扱い、quote_tweet_id での引用など）に戻ります。
- `approval: "all"` の明示保存は旧版でも同じ動作なので戻す必要はありません。
- 旧版の `prisma migrate deploy` は、旧版に無いマイグレーションが適用済みでもエラーにならず「No pending migrations」で終わります（ローカルの DB で確認済み）。

### DB も戻す場合（通常は不要）
バックアップから復元するのが確実です。部分的に戻す場合の SQL（**実行前に必ずバックアップ**）:

```sql
DROP TABLE IF EXISTS "youtube_videos", "youtube_channels";
DROP TABLE IF EXISTS "improvement_schedules", "knowledge_revisions";
DROP INDEX IF EXISTS "improvement_cycles_avatar_id_scheduled_for_key";
ALTER TABLE "improvement_cycles" DROP COLUMN IF EXISTS "attempt", DROP COLUMN IF EXISTS "completed_at", DROP COLUMN IF EXISTS "error",
  DROP COLUMN IF EXISTS "lease_until", DROP COLUMN IF EXISTS "mode", DROP COLUMN IF EXISTS "next_interval_days",
  DROP COLUMN IF EXISTS "run_status", DROP COLUMN IF EXISTS "scheduled_for";
DROP INDEX IF EXISTS "knowledge_items_avatar_id_status_idx";
ALTER TABLE "knowledge_items" DROP COLUMN IF EXISTS "created_by", DROP COLUMN IF EXISTS "evidence", DROP COLUMN IF EXISTS "kind",
  DROP COLUMN IF EXISTS "scope", DROP COLUMN IF EXISTS "source_fetched_at", DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "version";
DROP TABLE IF EXISTS "api_rate_counters", "idempotency_records", "api_audit_logs", "api_keys";
DROP TABLE IF EXISTS "price_entries", "usage_ledger";
DELETE FROM "_prisma_migrations" WHERE "migration_name" IN (
  '20261003050000_youtube_learning', '20261003040000_knowledge_v2_improvement_schedule',
  '20261003030248_api_keys', '20261003025431_usage_ledger_price_table');
```

## 5. テスト

`pnpm test`（`AVATAR_CMD_DB_TESTS=1` と使い捨て DB で実 DB テストも実行）: 106 件すべて成功。型チェック（全パッケージ）・Next.js ビルド成功。
DB テストは設定を共有するため、テストファイルは直列で実行します（`--test-concurrency=1`）。

| 要件のテスト項目 | テスト |
|---|---|
| API 権限不足・アバター外・失効・期限切れ | `api-v1.test.ts` |
| 重複リクエスト（並行・再送・内容違い） | `api-v1.test.ts` |
| Jev 障害 | `rule-edit.test.ts`, `automation.test.ts` |
| 停止済みルール・既存予約・承認条件の変更 | `rule-edit.test.ts` |
| 動画本文の取得失敗・本文待ち | `youtube-learning.test.ts` |
| 単価不明（未算定）・二重計上 | `usage.test.ts` |
| 14〜27日周期（時刻・乱数を制御。再起動・並行実行・再試行） | `improvement.test.ts` |
| 引用 URL（スペース・重複・分割） | `post-text.test.ts`, `platforms.test.ts`, `quote-rule.test.ts` |
