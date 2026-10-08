#!/usr/bin/env bash
# 配布用 ZIP を作る（買い切りプラン: X / Threads / note のみ有効）
#   bash scripts/make-dist-zip.sh            → dist/avatar-cmd-<version>-buyout.zip
#   bash scripts/make-dist-zip.sh out.zip    → 出力先を指定
# git にコミット済みのファイルだけを入れる（.env・node_modules・ビルド成果物は入らない）。
# 作る側のためのメモ（docs/EDITION.md）とこのスクリプトは入れない。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(git rev-parse --show-toplevel)"
PREFIX="$(git rev-parse --show-prefix)"   # 例: avatar-cmd_v3/
VERSION="$(node -p "require('./package.json').version")"
OUT="${1:-dist/avatar-cmd-${VERSION}-buyout.zip}"
mkdir -p "$(dirname "$OUT")"
if [ -n "$(git status --porcelain -- .)" ]; then
  echo "注意: コミットしていない変更は ZIP に入りません" >&2
fi
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
(cd "$ROOT" && git archive --format=zip --prefix=avatar-cmd/ -o "$OUT_ABS" "HEAD:${PREFIX}" -- . ":(exclude)docs/EDITION.md" ":(exclude)scripts/make-dist-zip.sh")
echo "作成しました: $OUT ($(git rev-parse --short HEAD))"
