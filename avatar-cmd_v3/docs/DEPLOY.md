# Avatar CMD v3 — デプロイ手順書（VPS / Docker Compose）

このファイルだけ読めば、VPS への導入から SNS 連携まで進められるようにしています。

## 構成

| コンテナ | 役割 | 目安リソース |
|---|---|---|
| `db` | PostgreSQL 16 | 0.5 core / 512MB |
| `migrate` | 起動時に DB マイグレーションを適用して終了 | — |
| `web` | ダッシュボード（Next.js）。設定画面・OAuth・メディア公開 | 1.0 core / 768MB |
| `worker` | 予約投稿キューを処理して各 SNS へ送信 | 0.5 core / 512MB |

合計でおよそ 2 core / 1.8GB。`web` と `worker` はアップロードしたメディアをボリューム `media` で共有します。

## 1. 前提

- Docker / Docker Compose v2 が入った VPS（例: Xserver VPS, Ubuntu 22.04）
- 外部から HTTPS でアクセスできるドメイン（OAuth のリダイレクト先・Instagram/Threads の画像取り込みに必須）
- 既存の Traefik を使う場合は、そのネットワーク名（`docker network ls | grep traefik`）

## 2. 取得と .env 生成

```bash
git clone <このリポジトリ> /opt/avatar-cmd-src
cd /opt/avatar-cmd-src/avatar-cmd_v3

# 秘密鍵・DBパスワード・管理者パスワードを自動生成（既存の .env は上書きしない）
bash scripts/setup-env.sh https://avatar-cmd.example.com
```

表示された **管理者パスワード** を控えてください。`.env` の `ENCRYPTION_KEY` は、
ダッシュボードで入力した認証情報の暗号鍵です。**紛失すると復号できない**ので、`.env` をバックアップしてください。

Traefik のネットワーク名が `traefik-net` 以外なら `.env` に追記します:

```bash
echo "TRAEFIK_NETWORK=<既存ネットワーク名>" >> .env
```

## 3. 起動

```bash
# Traefik 経由で公開（推奨）
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build

# Traefik を使わず、ポート 3333 で公開する場合
docker compose up -d --build
```

確認:

```bash
docker compose ps                 # migrate が "exited (0)"、web / worker / db が running
docker compose logs -f worker     # "[worker] started" が出ていれば OK
```

## 4. ダッシュボードでの初期設定

`https://<ドメイン>/login` に管理者パスワードでログインし、**設定** を開きます。

1. **システム** タブ: 公開URL が実際のURLになっているか確認（違えば「この URL を使う」→保存）。
2. **SNS連携アプリ** タブ: 使う SNS を開き、表示されている手順とリダイレクトURIに従って
   各社の開発者ポータルでアプリを作成し、Client ID / Secret 等を入力して保存。
3. **アカウント** タブ: アバターを選び、各 SNS の「認証して接続」または「接続情報を入力」から接続。
4. **システム** タブの「AI」に Gemini API キーを入力（AI 下書き・自動化ルールを使う場合）。モデルは既定で `gemini-3.8-flash`。
5. **アバター管理**: 口調・得意トピック・禁止事項などのペルソナを入力（AI 生成に使われます）。
6. **投稿** ページ: 投稿先を選んで本文・画像を入れ、投稿または予約。「AIで下書き」で本文を生成できます。
7. **自動化ルール**: 時刻または間隔を決めて、AI 生成 →「下書き（投稿ページで承認）」または「自動投稿」。

SNS ごとに必要なもの:

| SNS | ダッシュボードに入力するもの | 開発者ポータル側の作業 |
|---|---|---|
| X | OAuth 2.0 Client ID / Secret | OAuth 2.0 有効化・Read and write・リダイレクトURI登録。投稿には API クレジット/プランが必要 |
| Threads | Threads App ID / Secret | Meta アプリに「Threads API」ユースケース追加・リダイレクトURI登録 |
| Instagram | Instagram App ID / Secret | 「Instagram ログインによる API 設定」追加・リダイレクトURI登録。プロアカウントのみ |
| Facebook ページ | App ID / Secret | 「Facebook ログイン for Business」・リダイレクトURI登録 |
| YouTube | OAuth クライアント ID / シークレット | YouTube Data API v3 有効化・同意画面・リダイレクトURI登録。公開投稿には監査が必要 |
| TikTok | Client Key / Secret | Login Kit + Content Posting API（Direct Post）。監査前は「自分のみ」公開 |
| LinkedIn | Client ID / Secret | Share on LinkedIn + Sign In with LinkedIn (OpenID Connect)・リダイレクトURI登録 |
| Reddit | Client ID / Secret（+User-Agent） | web app 作成・Responsible Builder Policy の API アクセス承認 |
| Bluesky | ハンドル + アプリパスワード | 不要 |
| WordPress | サイトURL + ユーザー名 + アプリケーションパスワード | 不要 |
| Zenn | 連携済み GitHub リポジトリ + Fine-grained PAT | Zenn ダッシュボードで GitHub 連携 |
| note | ログインCookie（`_note_session_v5`） | 不要（非公式・下書き保存まで） |
| Medium | 発行済み Integration token | 新規発行は終了 |
| Substack / Amebaブログ / stand.fm | — | 公開APIが無いため自動投稿非対応 |

## 5. 運用

```bash
# 更新
git pull && docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build

# DB バックアップ
docker compose exec db pg_dump -U avatar avatar_cmd > backup_$(date +%Y%m%d).sql
```

- API のバージョン（Meta Graph API / LinkedIn-Version）は **設定 > システム** で変更できます。
- 失敗した投稿は **投稿** ページから再送できます。通信エラー等は自動で最大3回（指数バックオフ）再試行し、
  認証切れ・設定不備などは即座に「失敗」になります（エラー内容が表示されます）。
- トークンの自動更新: X / YouTube / Reddit / TikTok / LinkedIn（リフレッシュトークンがある場合）は投稿直前に更新、
  Threads / Instagram の長期トークンは失効7日前から更新します。Facebook ページのトークンは失効しません。
  LinkedIn（60日）や note の Cookie は期限が来たら再接続してください。

## トラブルシューティング

| 症状 | 確認すること |
|---|---|
| OAuth で「redirect_uri が一致しない」 | 設定 > システム の公開URLと、開発者ポータルに登録したリダイレクトURIが完全一致しているか |
| Instagram / Threads の画像投稿が失敗 | `https://<ドメイン>/media/<ファイル>` が外部から見えるか（Traefik・ファイアウォール） |
| ダッシュボードに「worker が停止しています」 | `docker compose ps` で worker が running か、`docker compose logs worker` にエラーが無いか |
| 自動化ルールが「Gemini API キーが未設定」で失敗 | 設定 > システム > AI でキーを入力 |
| 「ENCRYPTION_KEY が未設定」 | `.env` に値があるか、`docker compose up -d` で再作成したか |
| 保存済み認証情報が読めない | `ENCRYPTION_KEY` を変えていないか（変えた場合は各アカウントを再接続） |
