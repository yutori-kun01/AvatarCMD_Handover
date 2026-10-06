# v3.7 リリースノート — 変更点・未検証事項・DB 移行・ロールバック

> 計画: `docs/IMPROVEMENT_PLAN_v3.7.md`。決定事項（2026-10-06）: note の有料ライン・価格は下書きの段階で自動設定してよい／画面の統合 OK／旧版・未使用パッケージの削除 OK。
> 画像生成 API（OpenAI / Gemini）の選定は、比較テストの結果を見て決める（本リリースに比較テストを同梱）。

## 1. 変更点

### ① 指標の推移（フォロワー増減・閲覧数・反応率）
- `account_snapshots` に日別の **閲覧数・反応数** を記録（worker が 1 日 1 回）
  - Threads: アカウントインサイト `views` の日別値（公式）
  - X: 投稿ごとの指標（`impression_count` など）の **前回取得からの増分** を、その日のアカウントの値として計上（追加の API 費用なし。公開から 14 日を過ぎた投稿の伸びは入らない）
  - note: 記事ごとの累計 PV・スキの合計を取り、**前日の累計との差分** を日別の値にする（非公式 API）
- `timeseries()` / `GET /api/timeseries?range=7d|30d|90d&avatarId=&accountId=`: 収益・投稿・失敗・フォロワー（数と前日比）・閲覧数・反応数・反応率の日別推移と、直前の同じ長さの期間との比較。ダッシュボードの日別集計（`overview().daily`）はこちらに統合して削除

### ② 指標で切り替えるグラフ
- ダッシュボードとアバター詳細の上部に「収益／フォロワー増減／閲覧数／反応率／投稿」の数字カード。押すとその指標のグラフに切り替わる（棒・折れ線の切り替えは廃止。指標ごとに形を固定、1 つのグラフに軸は 1 本）
- 期間 7日／30日／90日、前期比、「表で見る」。選んだ指標・期間は URL に残る
- アバターカードにフォロワーの 30 日推移（スパークライン）

### ③ プロフィール画像 → アバターのアイコン
- フォロワー数の取得と同じ呼び出しでプロフィール画像も取得（X は 400×400、Threads・Bluesky・YouTube・note も）。期限付きの CDN URL を避けるため `MEDIA_DIR` に保存
- アイコンは **手動設定 > X > Threads > Bluesky > YouTube > その他** の順。手動で設定したアイコンは自動取得で上書きしない（アバター画面の「変更」「自動に戻す」）
- サイドバー・ダッシュボード・アバター画面にアイコンを表示

### ④ note の下書き（公開の直前まで）
- 本文画像のアップロード、見出し画像、**有料ライン**（本文の `<!-- paywall -->` の位置）、**価格**、タグまで下書きに入れる。**公開ボタンだけは人が押す**
- 画像・見出し画像・有料設定が note 側で拒否された場合も、本文の下書きは保存し、入らなかった項目を投稿一覧の補足に出す
- note のフォロワー数・PV も記録

### ⑤ note 記事エディタ・画像・図解（投稿・記事 > note 記事）
- AI で本文を書く（有料記事なら有料ラインの位置も提案）→「見出しごとの画像・図解を提案」で `<!-- image: … -->` / `<!-- infographic: … -->` の目印を入れる → 「作る」で画像にして `![説明](media:…)` に置き換え → 見出し画像・価格・タグ → note の下書きへ
- **イメージ画像**: 画像生成 AI（OpenAI / Gemini を設定で選択）。アバターのスタイル定義と参考画像（最大 4 枚）を渡し、画像内に文字を入れない
- **インフォグラフィック図解**: AI は「型・アイコン名・短いラベル・数値」だけを設計し、テンプレートで SVG → PNG に描く（文字・数値が崩れない。画像生成の費用なし）。型は手順・比較・循環・階層・大きな数字・グラフ（棒/円/折れ線）・チェックリスト。文字数の上限（タイトル 20 / ラベル 12 / 補足 24 / 合計 160）を超えたら AI に 1 回作り直させる。アイコンは Font Awesome Free / Bootstrap Icons / Lucide を同梱（存在しない名前は近いアイコンに置き換え）
- **アバター > 画像スタイル**: 参考画像（イメージ画像用・図解用、各 20 枚まで）を登録 →「AI でスタイルを作る」（画像を読めるモデル）→ 色・角丸・アイコンの塗り/線・画風・雰囲気・構図・避けることを画面で直せる → 図解の試し描き
- **設定 > 画像生成**: プロバイダ・モデル・画質の設定と **比較テスト**（同じプロンプトで両社を生成し、画像・時間・トークン・料金表での費用を並べる。「こちらを使う」で切り替え）
- 使用量は共通台帳に記録（用途: 画像生成 / 比較テスト / 画像スタイル分析 / 画像・図解の設計）。月の予算を超えると画像生成は止まる

### ⑥ 画面の統合（サイドバー 10 項目 → 6 項目）
| 新 | 中身 | 旧 URL |
|---|---|---|
| ダッシュボード | 指標タブ・対応が必要なこと・運用の状況・アバター・**アクティビティ** | `/activity` → `/dashboard#activity` |
| 投稿・記事 | SNS 投稿 / **note 記事** | — |
| アバター | 分析 / プロフィール / **画像スタイル** / アクティビティ | — |
| 分析・収益 | （旧 収益分析） | — |
| 自動化 | （旧 自動化ルール） | — |
| ナレッジ・学習 | ナレッジ・改善 / **YouTube 学習** | `/youtube` → `/knowledge?tab=youtube` |
| 設定 | アカウント / **プラットフォーム** / SNS連携アプリ / システム / **画像生成** / **API コスト** / セキュリティ / 外部AI API | `/sns` → `/settings?tab=platforms`、`/costs` → `/settings?tab=costs` |

### ⑦ 整理
- 削除: `packages/core`（使用は `CredentialVault` の 1 ファイルのみ → `packages/integrations/src/security` へ移動）、`packages/chrome-empire`（未使用）、リポジトリ直下の旧版 `Avater_CMD_v2/`（git の履歴には残る）

## 2. 未検証事項（本番反映前・反映後に確認が必要）

| 項目 | 内容 |
|---|---|
| **note の画像・見出し画像・有料設定** | エンドポイント（`/api/v1/upload_image`、`/api/v1/image_upload/note_eyecatch`）と `draft_save` の `price` / `separator` の項目名は、参考記事を作業環境から読めなかったため **未確認**（モックでのテストのみ）。拒否されても本文は保存されるが、実アカウントで 1 件だけ下書きを作り、編集画面で画像・有料ライン・価格を確認すること。違っていればブラウザで手動保存したときの通信内容に合わせて `platforms/note.ts` を直す |
| note の太字 | 本文は `<strong>` で送っている（従来どおり）。note の編集画面で太字として表示されるか |
| note のプロフィール画像・PV | `current_user` の画像の項目名（`profile_image_path` 等）と `stats/pv` の集計が想定どおりか |
| Threads の日別閲覧数 | `threads_insights?metric=views&since=&until=` の日別値の形式（`values[].end_time`）。`threads_manage_insights` の権限とフォロワー 100 人以上の条件 |
| X の閲覧数 | 公開から 14 日以内の投稿の増分のみ。アカウント全体のインプレッションとは一致しない |
| **画像生成のモデル名・料金** | 既定モデル `gpt-image-1-mini` / `gemini-2.5-flash-image` と、比較スクリプトの単価（2025 年時点の公開価格）は要確認。設定画面でモデル名を変えられる |
| **OpenAI と Gemini の品質・費用の比較** | この作業環境では API キーが無く、`api.openai.com` もネットワークで拒否されるため **未実施**。手順は下の「比較テストの実行」 |
| 図解の日本語フォント | Docker の web イメージに `fonts-noto-cjk` を追加。ローカル（フォント無し）では代替フォントになる |
| 画面 | `next dev` + デモデータでダッシュボード・アバター（分析・画像スタイル）・設定（画像生成・プラットフォーム・API コスト）・ナレッジ（YouTube）・note 記事エディタ・旧 URL のリダイレクトを表示確認済み。AI の呼び出しを伴う操作（記事の生成・画像の生成・スタイル分析）は API キーが無いため未確認 |

### 比較テストの実行
- **画面から**: 設定 > システム > AI に OpenAI と Gemini のキーを入れる → 設定 > 画像生成 > 比較テスト（アバターを選ぶと、記事の画像と同じスタイル・参考画像の条件で比べる）
- **コマンドから**（DB 不要）:
  ```bash
  cd avatar-cmd_v3/packages/integrations
  OPENAI_API_KEY=... GEMINI_API_KEY=... pnpm compare-images ./image-compare [参考画像のフォルダ]
  # → image-compare/report.html（画像を並べた比較）と summary.json（1 枚あたりの時間・概算費用）
  ```
  既定は `gpt-image-1-mini`(low/medium)・`gpt-image-1`(medium)・`gemini-2.5-flash-image` × プロンプト 2 本（計 8 枚）。単価は `scripts/compare-images.ts` の `PRICES` を料金ページで確認してから使う。

## 3. DB 移行（すべて追加のみ）

| マイグレーション | 内容 |
|---|---|
| `20261006002914_v37_media_insights_style` | `account_snapshots` に `views` `engagements` `views_total` `engagements_total` `source`、`sns_accounts` に `profile_image_url` `profile_image_hash`、`avatars` に `avatar_image_source` `image_style`（既定 `{}`）、新テーブル `style_references` |

反映手順は v3.6 と同じ（バックアップ → 取得 → `docker compose ... up -d --build`。migrate コンテナが自動で適用）。web イメージはフォントの追加で約 60MB 大きくなります。追加の環境変数は不要です（画像生成のキーは設定画面の AI キーと共通）。

反映後の確認（実投稿はしない）:
1. ダッシュボードで指標カードを押してグラフが切り替わるか。翌日以降、閲覧数・フォロワーの推移が増えていくか
2. X / Threads を接続したアバターのアイコンが、翌日の取得後にプロフィール画像になるか
3. 設定 > 画像生成 の比較テスト → 使うプロバイダを選ぶ
4. note 記事エディタで短いテスト記事（画像 1 枚・有料ライン・価格 100 円）を下書き保存 → note の編集画面で確認（**公開しない**）

## 4. ロールバック

### アプリだけ戻す（推奨。DB はそのまま）
追加した列・テーブルは旧版から参照されないため、旧版のイメージでそのまま動きます。

```bash
git checkout 15121e8   # 反映前のコミット
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

### DB も戻す場合（通常は不要。実行前に必ずバックアップ）
```sql
DROP TABLE IF EXISTS "style_references";
ALTER TABLE "avatars" DROP COLUMN IF EXISTS "avatar_image_source", DROP COLUMN IF EXISTS "image_style";
ALTER TABLE "sns_accounts" DROP COLUMN IF EXISTS "profile_image_url", DROP COLUMN IF EXISTS "profile_image_hash";
ALTER TABLE "account_snapshots" DROP COLUMN IF EXISTS "views", DROP COLUMN IF EXISTS "engagements",
  DROP COLUMN IF EXISTS "views_total", DROP COLUMN IF EXISTS "engagements_total", DROP COLUMN IF EXISTS "source";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261006002914_v37_media_insights_style';
```

## 5. テスト
- `pnpm test`（実 DB あり）: 全件成功。追加: 閲覧数の記録（日別・累計差分・投稿の増分）と `timeseries` の期間比較、プロフィール画像の優先順位と手動設定の保護、note の画像・有料ライン・価格・拒否時の保存、Threads の日別閲覧数、図解（全型の描画・文字数検証・アイコン解決）、記事の目印、OpenAI / Gemini の画像生成（モック）
- 型チェック（integrations / worker / web）・`next build` 成功
