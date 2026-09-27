# ============================================
# Avatar CMD v3 — Multi-stage Docker Build
# ============================================
#   docker build --target web    -t avatar-cmd-web .
#   docker build --target worker -t avatar-cmd-worker .
# （通常は docker compose up -d --build で両方ビルドされる）

ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
# Prisma は OpenSSL (libssl3) を必要とする。slim イメージには無いので追加する
RUN if ! ls /usr/lib/*/libssl.so.3 >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
      && rm -rf /var/lib/apt/lists/*; \
    fi
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── Dependencies ──
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/chrome-empire/package.json ./packages/chrome-empire/
COPY packages/integrations/package.json ./packages/integrations/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile

# ── Build ──
FROM deps AS builder
COPY . .
RUN pnpm --filter @avatar-cmd/db exec prisma generate \
  && pnpm --filter @avatar-cmd/web build \
  # pnpm 構成では Next の standalone 出力に Prisma のクエリエンジンが含まれないため手動で配置する
  && cp node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/libquery_engine-*.so.node \
        apps/web/.next/standalone/apps/web/.next/server/

# ── Worker（予約投稿の送信・DBマイグレーション） ──
FROM builder AS worker
ENV NODE_ENV=production
RUN mkdir -p /app/data/media && chown -R node:node /app/data
USER node
# pnpm を経由せず直接起動（非rootユーザーで corepack がダウンロードを試みないように）
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]

# ── Web（Next.js standalone） ──
FROM base AS web
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/data/media && chown -R node:node /app/data
USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
