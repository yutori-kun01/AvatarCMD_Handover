# 配布版（買い切りプラン）

このブランチは買い切りプランで配布するための版です。メインの開発版との違いは **使えるプラットフォームだけ** です。

| | 配布版 | 開発版（main） |
|---|---|---|
| X | ✅ | ✅ |
| Threads | ✅ | ✅ |
| note（下書き保存） | ✅ | ✅ |
| Instagram / Facebook / YouTube / TikTok / LinkedIn / Reddit / Bluesky / WordPress / Zenn / Medium / Substack / Amebaブログ / stand.fm | 準備中 | ✅（各SNSの対応状況どおり） |

- 準備中のプラットフォームは、設定・SNS運用の画面に「準備中」と表示され、アプリ登録・アカウント接続・投稿はできません（API から呼んでも受け付けません）。
- AI 生成・自動化ルール・ナレッジ・学習ソース（YouTube / RSS）・収益分析などの機能は開発版と同じです。

## 有効なプラットフォームを変える

`packages/integrations/src/edition.ts` の `ENABLED_PLATFORMS` を編集します（`null` にすると全プラットフォームが有効）。

```ts
export const ENABLED_PLATFORMS: readonly Platform[] | null = ["x", "threads", "note"];
```

## 配布用 ZIP を作る

```bash
cd avatar-cmd_v3
bash scripts/make-dist-zip.sh        # → dist/avatar-cmd-<version>-buyout.zip
```

コミット済みのファイルだけが入ります（`.env`・`node_modules`・ビルド成果物は入りません）。
ZIP を展開した `avatar-cmd/` で、README の「クイックスタート」の手順どおりにセットアップできます。

## 開発版の変更を取り込む

```bash
git fetch origin main
git merge origin/main   # 衝突しやすいのは画面の「準備中」表示を入れた箇所（settings/*-section.tsx など）
```
