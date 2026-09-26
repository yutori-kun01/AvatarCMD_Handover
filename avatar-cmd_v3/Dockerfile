# syntax=docker/dockerfile:1.7
# ============================================
# Avatar CMD v3 — Multi-stage Docker Build
# ============================================
# Targets:
#   web       — Next.js dashboard + API + scheduler/queue worker
#   migrator  — one-shot: prisma migrate deploy + seed
#   chrome    — Chrome Empire Playwright worker
# ============================================

ARG NODE_VERSION=22
ARG PLAYWRIGHT_VERSION=1.63.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

# ── Dependencies ──
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/chrome-empire/package.json ./packages/chrome-empire/
COPY packages/integrations/package.json ./packages/integrations/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Build ──
FROM deps AS builder
COPY . .
RUN pnpm --filter @avatar-cmd/db db:generate \
 && pnpm --filter @avatar-cmd/web build \
 && pnpm --filter @avatar-cmd/chrome-empire build

# ── Migrator (prisma CLI + tsx available) ──
FROM builder AS migrator
ENV NODE_ENV=production
# Soul files are written as root here; hand them to the web user (uid 1001)
CMD ["sh", "-c", "pnpm --filter @avatar-cmd/db db:deploy && pnpm --filter @avatar-cmd/db db:seed && chown -R 1001:1001 \"$AVATAR_DATA_DIR\""]

# ── Web (production) ──
FROM base AS web
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AVATAR_DATA_DIR=/app/data/avatars
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/data/avatars/_template ./data/avatars/_template
RUN chown nextjs:nodejs /app/data /app/data/avatars
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ── Chrome Empire worker ──
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS chrome
ARG PLAYWRIGHT_VERSION
WORKDIR /app
ENV NODE_ENV=production \
    CHROME_DATA_DIR=/app/data/chrome
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} \
 && mkdir -p /app/data/chrome && chown -R pwuser:pwuser /app/data
COPY --from=builder /app/packages/chrome-empire/dist/worker.js ./worker.js
USER pwuser
CMD ["node", "worker.js"]
