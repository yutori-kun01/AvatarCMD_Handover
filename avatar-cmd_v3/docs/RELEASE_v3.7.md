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

### ⑦ 画像生成の決定事項（2026-10-06 追記）
- 画像生成は **OpenAI**、推奨モデル **`gpt-image2.5-sunburst`**、品質 **high** を既定に（設定 > 画像生成 で変更可）
- 出力サイズを用途ごとに固定し、生成後に中央基準で切り抜く: **見出し画像（note のサムネイル）1280×670**（note 推奨）／**見出しの下の画像・図解 1280×720**。形式は **PNG（既定）か WebP**
- **デザイン DNA**: スタイル定義をアバターごとに 1 つに統一。スタイルプロンプト（画像生成 AI に渡す作風）と色・角丸・アイコンの塗り/線を、イメージ画像のプロンプトと図解の描画の両方に使い、2 つがかけ離れたデザインにならないようにした。参考画像はイメージ画像用・図解用の両方から 1 つの DNA を作る

### ⑧ X API の費用の最適化（2026-10-06 追記。詳細は `docs/X_API_COST_PLAN.md`）
- **自分の投稿の指標**: `GET /2/users/{id}/tweets`（一覧の読み直し・最大 300 件）をやめ、`GET /2/tweets?ids=` で **期限の来た投稿だけ** 読む。取得はモードの時点（BALANCED: 公開から 1h / 6h / 24h）だけで、時点ごとの値を `post_metric_snapshots` に残す（止まっていた間の時点はさかのぼって読まない）
- **引用探索**: `exclude=replies,retweets`、投稿者情報（`expansions`）を外す。モードの時刻（BALANCED: 08:00 / 18:00）・件数（12 件）だけ読む。軽い採点の上位（3 件）だけ判定し、その投稿者名だけを `x_users` キャッシュ経由で取得（User Read）。月の引用案の上限（BALANCED: 20 件）
- **プロフィール**: モードの間隔（ECO は 2 日に 1 回）。User Read として記録
- **モード**: ECO / **BALANCED（既定）** / AGGRESSIVE / **カスタマイズ**（指標の時点・探索の時刻・件数・判定する件数・引用の上限・プロフィールの間隔・キャッシュ期間を自由に設定）。各モードの月額の見積もりを表示
- **予算（アバターごと）**: 今月の X 費用（Post Read / User Read / Post Create × 単価 × 為替）が縮小する額（既定 ¥800）を超えたら探索 1 日 1 回・10 件・指標は後ろ 2 時点、上限（既定 ¥1,000）で引用探索と引用案の作成を停止。通常投稿と自分の投稿の分析は続ける
- **時刻**: 通常投稿と引用探索の **回数はモードで固定、時刻は利用者が設定**（アバター > X API > 時刻。既定は通常投稿 09:00 / 19:00、探索 08:00 / 18:00）。カスタマイズでは回数も変えられる。自動化ルールが X に作る通常投稿は、この時刻の空いている枠（今日・明日）に予約し、枠が埋まっていれば下書きにする（予約を先へ積み上げない。1 日の回数はモードの回数を超えない）。手動の投稿は対象外
- 画面: アバター > **X API**（使用量のバー・モード・時刻・カスタマイズ・予算・単価と為替）、ダッシュボードのアバターカードに予算バー
- アカウント設定の「引用候補の自動探索」は「しない／する（モードの時刻）」に変更（旧設定の 12/24 時間ごとは「する」として扱う）

### ⑨ 整理
- 削除: `packages/core`（使用は `CredentialVault` の 1 ファイルのみ → `packages/integrations/src/security` へ移動）、`packages/chrome-empire`（未使用）、リポジトリ直下の旧版 `Avater_CMD_v2/`（git の履歴には残る）

## 2. 未検証事項（本番反映前・反映後に確認が必要）

| 項目 | 内容 |
|---|---|
| **X の単価と課金の単位** | 単価（Post Read $0.005 / User Read $0.010 / Post Create $0.015）は共有いただいた値。`GET /2/tweets?ids=` で見つからない投稿・`/2/users?ids=` が課金対象になるか、`expansions` を外した後に User Read の請求が減るかを、反映後 1 週間の X の請求画面と 設定 > API コスト の件数で突き合わせる |
| **note の画像・見出し画像・有料設定** | エンドポイント（`/api/v1/upload_image`、`/api/v1/image_upload/note_eyecatch`）と `draft_save` の `price` / `separator` の項目名は、参考記事を作業環境から読めなかったため **未確認**（モックでのテストのみ）。拒否されても本文は保存されるが、実アカウントで 1 件だけ下書きを作り、編集画面で画像・有料ライン・価格を確認すること。違っていればブラウザで手動保存したときの通信内容に合わせて `platforms/note.ts` を直す |
| note の太字 | 本文は `<strong>` で送っている（従来どおり）。note の編集画面で太字として表示されるか |
| note のプロフィール画像・PV | `current_user` の画像の項目名（`profile_image_path` 等）と `stats/pv` の集計が想定どおりか |
| Threads の日別閲覧数 | `threads_insights?metric=views&since=&until=` の日別値の形式（`values[].end_time`）。`threads_manage_insights` の権限とフォロワー 100 人以上の条件 |
| X の閲覧数 | 公開から 14 日以内の投稿の増分のみ。アカウント全体のインプレッションとは一致しない |
| **画像生成のモデル名・料金** | 既定モデル `gpt-image2.5-sunburst`（指定どおりの表記）が API で受け付けられるか、`output_format`（png / webp）に対応しているか。単価は料金表に登録するまで「未算定」 |
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
| `20261006012212_v37_x_api_policy` | `avatars.x_policy`（既定 `{}` = BALANCED）、新テーブル `post_metric_snapshots`・`x_users` |
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
DROP TABLE IF EXISTS "post_metric_snapshots", "x_users";
ALTER TABLE "avatars" DROP COLUMN IF EXISTS "x_policy";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261006012212_v37_x_api_policy';
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

## 追加: YouTube 学習の 404 対策・精度改善、RSS 学習

> ここに書いた動作確認は、ローカルの使い捨て PostgreSQL と外部 API のモック、本番ビルド（`next build` の standalone）の起動確認によるものです。
> **本番環境の YouTube フィード・実在の RSS への接続は確認していません**（作業環境から外部サイトに接続できないため）。

### 1. YouTube 学習:「直近のエラー: youtube API 404: <!DOCTYPE html>…」への対策

**原因:** 新しい動画の検知に使っている公開フィード（`https://www.youtube.com/feeds/videos.xml?channel_id=UC…`）が 404 の HTML ページを返していました。
YouTube のフィードは、チャンネル ID の誤りのほか、YouTube 側の都合で一時的に 404 を返すことがあります。
また、エラー表示が HTML をそのまま載せていたため、原因が読み取れませんでした。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| フィードが 404・5xx | そのままエラー | 1 回だけ再試行 → アップロード再生リストのフィード（`playlist_id=UU…`）→ YouTube Data API（`playlistItems.list`、1 回 1 ユニット。接続済みの YouTube アカウントを使用）の順に切り替え |
| すべて失敗したとき | `youtube API 404: <!DOCTYPE html>…` | 試した経路ごとの結果と、対処（チャンネル ID の確認・YouTube アカウントの接続）を表示 |
| エラー表示全般 | 応答本文をそのまま表示 | HTML のエラーページは `<title>` だけを表示（全 SNS 共通） |

**本番で確認してほしいこと:** チャンネル ID で `https://www.youtube.com/channel/UC…` が開けるか。開けない場合は ID の誤りです。
開けるのに失敗が続く場合は、設定 > アカウントで YouTube を接続しておくと Data API で取得します。

### 2. YouTube 学習: 要約の精度改善（以前の「URL 抽出システム」の知見を反映）

- **自動生成字幕の重複除去:** 自動字幕は前の行を次の行で繰り返す「流れる表示」のため、同じ文が 2〜3 回ずつ要約に渡っていました。伸びていく行は最後の行だけを残すようにしました。
- **注記の除去:** `[音楽]` `[拍手]` `[笑い]` `♪` などを本文から除きます。
- **字幕トラックの選び方:** 日本語の手動字幕 > 日本語の自動字幕 > 他の言語の手動字幕 > 英語の自動字幕 の順（以前は言語を見ずに「手動字幕の最初の 1 本」）。
- **要点の根拠の照合:** 句読点・空白・括弧・注記の違いを無視して照合し、長い抜粋は先頭・中央・末尾のいずれかで確認します。
  以前は完全一致だったため、モデルが句読点を整えただけの正しい要点まで捨てられ、要点が少なくなっていました。

**取り込まなかったもの:** 以前のシステムの `yt-dlp`（非公式の字幕・音声取得）と Whisper による文字起こしは、
他の人の動画については YouTube の利用規約・アクセス制限の確認が済むまで実装しない方針（IMPROVEMENT_PLAN の決定事項）のため、取り込んでいません。
またサーバー（データセンターの IP）からの `yt-dlp` はボット判定で止められることが多く、本番では安定しません。

### 3. RSS 学習（新機能）

**ナレッジ・学習 > RSS 学習** タブ（旧 `/rss` は `/knowledge?tab=rss` へリダイレクト）。ブログ・ニュース・note などの新着記事から学び、アバターのナレッジ（出典付きの事実）にします。

- 入力: フィードの URL、またはサイトの URL（`https://note.com/ユーザー名` は自動で `/rss`、ブログのトップページは `<link rel="alternate">` からフィードを探す）
- 対応形式: RSS 2.0 / Atom / RSS 1.0（RDF）。`&` のエスケープ漏れなど、よくある崩れも読みます
- 本文: フィードに全文（`content:encoded` など、600 文字以上）があればそれを使い、抜粋だけなら記事ページから本文だけを抽出（Mozilla Readability。note はスキ・おすすめ・クリエイター欄などを先に除去）
- 本文が取れない記事は「本文待ち」のまま理由を表示し、3 回失敗で「取得不可」。抜粋だけで要約したことにはしません。会員限定記事など、利用してよい本文は手で登録できます
- 要約は YouTube と共通（本文の抜粋を根拠に付け、本文に無い要点は捨てる）。モデルは 設定 > システム > AI の「動画・記事の要約」
- 二重取り込みの防止（フィード×guid）、取得頻度・対象期間・1 回の上限はフィードごと（初期値 6 時間・7 日・3 件）
- 安全: 内部ネットワーク（localhost・プライベート IP・クラウドのメタデータ IP など）の URL には接続しません（リダイレクト先も確認）。5MB・20 秒の上限
- 使用量は API コスト画面の「RSS（記事の要約）」に集計

#### 外部 AI からの登録（API）

`/api/v1/learning/...` で、AI エージェントが「本文待ち」の動画・記事に本文と要約を登録できます（`knowledge:write` 権限）。
要約まで AI 側で作ればこちらのモデルは呼ばず、要点の抜粋（quote）を本文と照合してから保存します。詳細は [API_V1.md](API_V1.md) の 4-2。

### 4. DB 移行

`packages/db/prisma/migrations/20261006020000_rss_learning`（`rss_feeds` / `rss_articles` の追加のみ。既存テーブルは変更なし）。
Docker では起動時の `migrate` サービスが自動で適用します（Docker を使わない場合は `pnpm db:deploy`）。

**ロールバック:** アプリを前の版に戻すだけで動きます（新しいテーブルは使われなくなるだけ）。テーブルも消す場合は `DROP TABLE rss_articles; DROP TABLE rss_feeds;` と `_prisma_migrations` の該当行の削除。

### 5. 依存パッケージ

`jsdom`・`@mozilla/readability` を追加（integrations と web）。web にも入れているのは、Next.js が jsdom を外部モジュールとして扱えるようにするためです
（同梱されると jsdom の同期 XHR 用ワーカーが誤って実行され、サーバーが例外を出すことを本番ビルドで確認したため）。
