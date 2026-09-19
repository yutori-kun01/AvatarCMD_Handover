# ============================================
# Avatar CMD v3 — Multi-stage Docker Build
# ============================================
# ターゲット:
#   web            … Next.js ダッシュボード (standalone)
#   worker         … アプリジョブキューの消費 (AI生成 / ナレッジ収集)
#   chrome-empire  … Playwright ワーカー (ブラウザジョブキューの消費)
#   migrator       … prisma migrate deploy / seed 用のワンショット
# ============================================

FROM node:24-alpine AS base
# Prisma のクエリエンジンは OpenSSL を必要とする
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

# ── Dependencies ──
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/chrome-empire/package.json ./packages/chrome-empire/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/queue/package.json ./packages/queue/
# Playwright のブラウザは chrome-empire 側のベースイメージに同梱されている
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile

# ── Build ──
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma Client は packages/db/generated/client に生成される。
# turbo の build は db:generate を呼ばないため明示的に実行する。
RUN pnpm --filter @avatar-cmd/db db:generate
RUN pnpm --filter @avatar-cmd/chrome-empire build
# chrome-empire は Playwright イメージ(Debian)で動くため alpine の
# node_modules を持ち込めない。単一CJSにバンドルして外部依存だけを入れる。
RUN pnpm --filter @avatar-cmd/chrome-empire build:worker
RUN pnpm --filter @avatar-cmd/web build

# ============================================
# web — Next.js standalone
# ============================================
FROM base AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
# standalone 出力は @prisma/client を外部依存として扱うためクエリエンジンを
# 同梱しない。生成物を明示的にコピーする。
COPY --from=builder /app/packages/db/generated ./packages/db/generated

# Soul Engine のアバターファイル置き場（compose で named volume をマウント）
RUN mkdir -p /app/data/avatars && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV AVATAR_DATA_DIR=/app/data/avatars

CMD ["node", "apps/web/server.js"]

# ============================================
# worker — アプリジョブキューの消費
# ============================================
# web はジョブを投入するだけで処理しない。web の再起動や
# レプリカ数に影響されずにジョブを処理するための常駐プロセス。
#
# core の dist(CJS) は @avatar-cmd/db が TS ソースを main にしているため
# node から直接 require できない。dist 化の連鎖を避けて tsx で実行する。
FROM base AS worker
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeuser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/queue ./packages/queue
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/core ./packages/core

# Soul Engine のファイルを読むため web と同じボリュームをマウントする
RUN mkdir -p /app/data/avatars && chown -R nodeuser:nodejs /app/data

USER nodeuser

EXPOSE 4100
ENV WORKER_PORT=4100
ENV AVATAR_DATA_DIR=/app/data/avatars

CMD ["pnpm", "--filter", "@avatar-cmd/core", "start:worker"]

# ============================================
# migrator — prisma migrate deploy / seed
# ============================================
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/db ./packages/db
WORKDIR /app/packages/db
CMD ["pnpm", "prisma", "migrate", "deploy"]

# ============================================
# chrome-empire — Playwright ワーカー
# ============================================
# Playwright のブラウザ同梱イメージを使う（Alpine 非対応のため Debian 系）。
# タグは packages/chrome-empire の playwright と同じバージョンに固定する。
# ずれるとブラウザとドライバのバージョン不一致で起動に失敗する。
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS chrome-empire
ENV NODE_ENV=production
WORKDIR /app

# バンドル済みの単一ファイルだけを持ち込む（@avatar-cmd/queue も同梱される）
COPY --from=builder /app/packages/chrome-empire/dist/worker.bundle.cjs ./dist/worker.bundle.cjs

# pnpm の node_modules はシンボリックリンク構造でステージ間コピーに向かず、
# alpine(musl) の成果物も Debian では使えないため、外部依存だけ入れ直す。
# ブラウザ本体はベースイメージに同梱されているのでダウンロードしない。
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --no-save --omit=dev playwright@1.63.0 bullmq@5.81.5

RUN mkdir -p /app/data/profiles /app/data/sessions && \
    chown -R pwuser:pwuser /app/data

USER pwuser

EXPOSE 4000
ENV CHROME_WORKER_PORT=4000
ENV CHROME_STORAGE_DIR=/app/data/profiles

CMD ["node", "dist/worker.bundle.cjs"]
