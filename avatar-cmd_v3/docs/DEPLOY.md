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

- Docker / Docker Compose v2 が入った VPS（例: Ubuntu 22.04）
- 外部から HTTPS でアクセスできるドメイン（OAuth のリダイレクト先・Threads の画像取り込みに必須）
- 既存の Traefik を使う場合は、そのネットワーク名（`docker network ls | grep traefik`）

## 2. 展開と .env 生成

```bash
unzip avatar-cmd-*.zip -d /opt   # → /opt/avatar-cmd
cd /opt/avatar-cmd

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
4. **システム** タブの「AI」に使う AI の API キー（Claude / OpenAI / Gemini）を入力し、
   用途ごとにプロバイダとモデルを選択（AI 下書き・自動化ルールを使う場合）。
   「自動」はキーのあるものを Claude → OpenAI → Gemini の順で使います。モデル欄が空欄なら下表の推奨モデルを使います。

   | 用途 | 使われる場所 | 推奨（最低限）Claude / OpenAI / Gemini |
   |---|---|---|
   | SNS 投稿文 | 投稿の「AIで下書き」・自動化（短文SNS） | `claude-sonnet-5` / `gpt-5-mini` / `gemini-3.8-flash`（品質重視なら `claude-opus-5`） |
   | 長文記事 | 同上（note） | `claude-opus-5` / `gpt-5` / `gemini-3.8-flash` |
   | 文字数調整 | 「AIで◯文字に調整」・生成結果が文字数を超えたとき | `claude-sonnet-5` / `gpt-5-mini` / `gemini-3.8-flash` |
   | 投稿前チェック | 「AIでチェック」・自動化の自動投稿モード | `claude-sonnet-5` / `gpt-5-mini` / `gemini-3.8-flash`（品質重視なら `claude-opus-5`） |
   | タグ提案 | タグ欄の「AIで提案」 | `claude-haiku-4-5` / `gpt-5-mini` / `gemini-3.8-flash` |

   自動化ルールの「自動投稿」モードでは、ルールごとに「自動承認の範囲」を選びます（作成・編集時に選択必須）:
   全自動（チェック結果に関わらず投稿）／条件付き（NG・Jev の保留・判定障害だけ承認待ち）／厳格（チェック OK かつ Jev 通過のみ投稿）。
   予約キューの投稿は送信直前に、アカウント・アバター・ルールの状態と承認範囲を再確認し、条件を満たさなければ下書きに戻します。
5. **アバター管理**: 口調・得意トピック・禁止事項などのペルソナを入力（AI 生成に使われます）。
6. **投稿** ページ: 投稿先を選んで本文・画像を入れ、投稿または予約。「AIで下書き」で本文を生成できます。
7. **自動化ルール**: 時刻または間隔を決めて、AI 生成 →「下書き（投稿ページで承認）」または「自動投稿」。

SNS ごとに必要なもの:

| SNS | ダッシュボードに入力するもの | 開発者ポータル側の作業 |
|---|---|---|
| X | OAuth 2.0 Client ID / Secret | OAuth 2.0 有効化・Read and write・リダイレクトURI登録。投稿には API クレジット/プランが必要 |
| Threads | Threads App ID / Secret | Meta アプリに「Threads API」ユースケース追加・リダイレクトURI登録 |
| note | ログインCookie（`_note_session_v5`） | 不要（非公式・下書き保存まで） |
| その他（Instagram / YouTube / Bluesky など） | — | 準備中（今後のアップデートで対応予定） |

### アバターごとの認証情報の管理

認証情報（トークン・アプリパスワード・Cookie 等）は **SNS アカウント単位＝アバター単位** で暗号化して保存されます。
**設定 > アカウント** で上部のアバターを切り替えると、そのアバターの接続だけを管理できます。

- **認証情報**（各アカウントのボタン）: 使用アプリ・取得日時・有効期限・スコープ・自動更新の可否を表示します。
  トークンやパスワードは末尾4文字と文字数だけの伏せ字で、平文は画面・API のどちらにも出しません（閲覧は監査ログに記録）。
  - **今すぐトークンを更新**: 期限前でもリフレッシュします（X / Threads）。
    Threads は Meta の仕様で発行から24時間以内は更新できません。
  - **再認証して取り直す**（OAuth）/ **認証情報を差し替え**（アプリパスワード・トークン・Cookie）
- **このアバター専用のアプリを使う**（OAuth 系 SNS の行）: そのアバターだけ別の開発者アプリ（Client ID / Secret）で認証します。
  ブランドごとにアプリを分けたい、API の利用上限をアプリ単位で分けたい場合に使います。未登録なら「SNS連携アプリ」の共通設定を使います。
  - 専用アプリの開発者ポータルにも同じリダイレクトURIを登録してください。
  - トークンは発行したアプリでしか更新できないため、アカウントごとに「どちらのアプリで接続したか」を記録しています。
    専用アプリを登録した後に共通アプリで接続済みのアカウントを専用アプリへ移すには「再接続」してください。
    専用アプリを解除・変更した場合も、そのアプリで接続したアカウントは再接続が必要です。

### 判定（Jev）・反応の分析・引用投稿

- **判定（TypeSafe Jev）**: 設定 > システム で API キーとモードを設定します。キーが無ければ従来どおり動きます。
  最初は「記録のみ（shadow）」で動かし、人の判断との一致率を確認してから「反映（gate）」に切り替えてください。
- **投稿の反応**: X は自分の投稿一覧から、Threads はインサイト API から worker が自動取得し、投稿ページに表示します。
  Threads は権限 `threads_manage_insights` を追加して **再接続** が必要です（フォロワー100人以上など Meta の条件あり）。
- **改善か継続か**: 自動化ルールページに、ルールごとの判定（継続 / 改善 / 停止を検討 / データ不足）と改善ポイントを表示します。
- **引用投稿（X）**: 投稿ページの「引用候補を探す」で、フォロー中の投稿から方向性が同じ投稿の引用案を下書きにします。
  タイムラインの読み取りは、その X アカウント自身の開発者アプリ（アバター専用アプリ）で接続していれば 1件 $0.001 です。

詳しくは [JEV_DECISION_LAYER.md](JEV_DECISION_LAYER.md)。

## 5. 運用

```bash
# 更新: 新しい ZIP を同じ場所に上書き展開（.env はそのまま残す）してから
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build

# DB バックアップ
docker compose exec db pg_dump -U avatar avatar_cmd > backup_$(date +%Y%m%d).sql
```

- 失敗した投稿は **投稿** ページから再送できます。通信エラー等は自動で最大3回（指数バックオフ）再試行し、
  認証切れ・設定不備などは即座に「失敗」になります（エラー内容が表示されます）。
- トークンの自動更新: X は投稿直前に更新、Threads の長期トークンは失効7日前から更新します。
  note の Cookie は期限が来たら再接続してください。
  状態の確認や手動更新は **設定 > アカウント > 認証情報** から行えます。

## トラブルシューティング

| 症状 | 確認すること |
|---|---|
| OAuth で「redirect_uri が一致しない」 | 設定 > システム の公開URLと、開発者ポータルに登録したリダイレクトURIが完全一致しているか |
| Threads の画像投稿が失敗 | `https://<ドメイン>/media/<ファイル>` が外部から見えるか（Traefik・ファイアウォール） |
| ダッシュボードに「worker が停止しています」 | `docker compose ps` で worker が running か、`docker compose logs worker` にエラーが無いか |
| 自動化ルールが「AI の API キーが未設定」で失敗 | 設定 > システム > AI で、その用途に割り当てたプロバイダのキーを入力 |
| 「ENCRYPTION_KEY が未設定」 | `.env` に値があるか、`docker compose up -d` で再作成したか |
| 保存済み認証情報が読めない | `ENCRYPTION_KEY` を変えていないか（変えた場合は各アカウントを再接続） |
