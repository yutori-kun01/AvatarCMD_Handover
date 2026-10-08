# Avatar CMD

AIアバターで **X / Threads / note** を運用するためのコマンドセンターです。
アバターごとのペルソナで AI が投稿文・記事を書き、予約投稿・自動化ルール・反応の分析・収益の記録までをひとつのダッシュボードで扱います。

> この配布版で使えるのは **X / Threads / note** です。その他のプラットフォーム（Instagram / YouTube / Bluesky など）は画面に「準備中」と表示され、今後のアップデートで対応予定です。

## 対応プラットフォーム

| SNS | 方式 | 投稿 |
|---|---|---|
| X | OAuth 2.0 + PKCE | 公式 API（`POST api.x.com/2/tweets`、メディアは `/2/media/upload`） |
| Threads | OAuth（長期トークン自動更新） | 公式 API（`graph.threads.net` コンテナ → `threads_publish`） |
| note | ログインCookie | 非公式・**下書き保存のみ**（公開は note の画面で行います） |

## クイックスタート

### 本番（VPS / Docker Compose）

```bash
unzip avatar-cmd-*.zip -d /opt && cd /opt/avatar-cmd
bash scripts/setup-env.sh https://avatar-cmd.example.com   # .env を自動生成（管理者パスワードが表示される）
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build   # Traefik 経由
# または: docker compose up -d --build                                             # ポート 3333 で公開
```

詳しい手順・SNSごとの開発者ポータル設定は **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照してください。

### ローカルで動かす

```bash
pnpm install
bash scripts/setup-env.sh http://localhost:3333   # DATABASE_URL はローカルの PostgreSQL に合わせて編集
pnpm db:deploy                                    # マイグレーション適用
pnpm dev                                          # web (http://localhost:3333) + worker を起動
```

## 設定の考え方

`.env` に置くのは起動に必要な値（DB・暗号鍵・管理者パスワード・公開URL）だけです。
**SNS の Client ID / Secret、トークン、アプリパスワード、ログインCookie、AI（Claude / OpenAI / Gemini）の API キーは
すべてダッシュボードの「設定」画面から入力**し、AES-256-GCM で暗号化して DB に保存されます。

| 画面 | できること |
|---|---|
| 設定 > SNS連携アプリ | 各SNSの開発者アプリ情報を登録。登録すべきリダイレクトURIと手順・公式ドキュメントへのリンクを表示 |
| 設定 > アカウント | アバターごとに SNS アカウントを接続（OAuth / Cookie）、投稿設定、認証情報の確認・今すぐ更新・差し替え、アバター専用の開発者アプリ |
| 設定 > システム | 公開URL、AI の API キーと用途ごとのプロバイダ・モデル |
| 設定 > セキュリティ | 管理者パスワード変更、ログアウト |
| 投稿 | 投稿先を選んで本文・画像・動画を投稿／予約。AI で下書き生成。送信状況・エラー・再送・下書きの承認 |
| ダッシュボード | 投稿数・成功率・予約/承認待ち・収益、worker 稼働状況、対応が必要なこと（すべて DB の実データ） |
| アバター管理 | アバターの作成・編集・一時停止・削除、ペルソナ（AI 生成に使用） |
| 自動化ルール | 毎日の時刻 or 一定間隔で AI が投稿文を生成し、下書き（承認制）または自動投稿（自動承認の範囲: すべて / NGのみ保留 / OKのみ） |
| アクティビティ / プラットフォーム | 実行ログ、プラットフォーム別の接続・投稿状況 |
| 収益分析 | アカウント別分析（バイタルチェック: 投稿・エラー・収益・フォロワー・反応を月単位で表示、前月へページ送り、アカウントごとの詳細グラフ）、収益アイテム（記事・商品を単価付きで登録し、次からは選んで日付・数量だけで記録）、全体の集計 |

## X / Threads の本文の整形

- 投稿前に「」を取り除く（AI 生成・手入力とも。本文全体を囲む『』や引用符も外す）
- 箇条書き（・ ① 1. など）は1項目ずつ改行し、前後の文とは空行で分ける。箇条書きがある投稿は200文字以内でも改行を残す

- 200文字以内: 改行を取り除いて1件で投稿します。
- 200文字超: アカウントの投稿設定「200文字を超える投稿」で、**改行ありで1件** か **ツリー型（200文字以内ずつ返信でつなぐ）** を選べます。
- 1件の上限（X は 280＝日本語 約140文字、Threads は 500文字）を超える場合は、どちらの設定でも自動でツリーに分けます。
  X Premium のアカウントは投稿設定「X Premium」を「あり」にすると長文を1件で投稿できます。
- Threads のツリー投稿には `threads_manage_replies` 権限が必要です（追加前に接続したアカウントは再接続してください）。

## 複数アバターで別々の X / Threads アカウントを使う

アバターごとに「アバター専用の開発者アプリ」を登録すると、そのアバターの接続・トークン更新・投稿はそのアプリで行われます（未登録なら共通アプリ）。
2つ目以降のアカウントを接続するときは、**ブラウザの X / Threads を接続したいアカウントにログインし直してから**「接続」を押してください
（ログイン中のアカウントで認可されるため、そのままだと1つ目と同じアカウントがつながります。重複した場合は接続時に警告が出ます）。
「別ブラウザで接続（URLコピー）」を押すと認可 URL がコピーされます。接続したいアカウントでログイン済みの別ブラウザ（別プロファイル・スマホでも可）で開いて認可すると、
元の画面に結果が自動で反映されます（別ブラウザ側で Avatar CMD へのログインは不要。URL は15分有効・1回限りで、開いた人のアカウントが接続されるので他人に共有しないでください）。
X API の従量課金クレジットは開発者アカウントごとなので、専用アプリの開発者アカウント側にもクレジットが必要です。

## 構成

```
avatar-cmd/
├── apps/web/                # Next.js ダッシュボード（設定・投稿・分析・OAuth・メディア公開）
├── apps/worker/             # 予約投稿・自動化ルール・反応の取得を処理する常駐プロセス
├── packages/db/             # Prisma（PostgreSQL）
├── packages/integrations/   # SNS 連携（1SNS = 1ファイル）と投稿・AI・分析のサービス層
├── scripts/setup-env.sh     # .env 自動生成
├── docker-compose.yml       # db / migrate / web / worker
└── docker-compose.traefik.yml  # 既存 Traefik 連携用オーバーライド
```

## ドキュメント

- [docs/DEPLOY.md](docs/DEPLOY.md) — 導入・初期設定・運用・トラブルシューティング
- [docs/API_V1.md](docs/API_V1.md) — 外部 AI エージェント向け API
- [docs/JEV_DECISION_LAYER.md](docs/JEV_DECISION_LAYER.md) — 判定レイヤー（TypeSafe Jev）
