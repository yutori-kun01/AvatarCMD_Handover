# 配布版（買い切りプラン）の管理メモ

> この文書と `scripts/make-dist-zip.sh` は配布用 ZIP には入りません（作る側のためのメモ）。

`release/buyout` ブランチは買い切りプランで配布するための版です。開発版（main）との違い:

- 使えるプラットフォームは **X / Threads / note** のみ。その他は画面に「準備中」と表示し、アプリ登録・アカウント接続・投稿をサーバー側でも拒否する
- 販売用のトップページ（料金プラン・ブログ）を削除し、`/` はダッシュボードへ転送する
- 社内向けの計画メモ・リリースノート・`Reports/`・画像比較スクリプトを削除し、テストデータの名前を仮名にしている
- README / DEPLOY は購入者向けの内容

## 有効なプラットフォームを変える

`packages/integrations/src/edition.ts` の `ENABLED_PLATFORMS` を編集する（`null` にすると全プラットフォームが有効）。

```ts
export const ENABLED_PLATFORMS: readonly Platform[] | null = ["x", "threads", "note"];
```

## 配布用 ZIP を作る

```bash
cd avatar-cmd_v3
bash scripts/make-dist-zip.sh        # → dist/avatar-cmd-<version>-buyout.zip
```

コミット済みのファイルだけが入る（`.env`・`node_modules`・ビルド成果物は入らない）。展開すると `avatar-cmd/` ができる。

## 開発版の変更を取り込む

```bash
git checkout release/buyout
git fetch origin main && git merge origin/main
```

衝突しやすいのは「準備中」表示を入れた画面（`settings/*-section.tsx`）と、削除したファイル（販売用ページ・社内メモ）。
削除したものが main 側で更新されていたら、削除のまま解決する。新しく社内メモや個人名が入っていないかも確認してから ZIP を作る。
