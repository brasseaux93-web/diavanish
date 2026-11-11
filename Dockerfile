# Diavanish — single-container self-hosting image
#
# Pinned to Node 24.22.1 LTS (Krypton) on Debian bookworm, multi-arch index
# digest fetched from Docker Hub on 2026-11-09. The digest, not the tag, is
# what gets pulled. To move forward:
#   docker buildx imagetools inspect node:24-bookworm-slim
# then replace both the tag and the @sha256:… below (build and runtime stages).
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000 \
    APERTURE_DB=/data/aperture.db \
    NPM_CONFIG_CACHE=/tmp/.npm \
    HOME=/tmp
# Production node_modules only (devDependencies pruned in the build stage).
# better-sqlite3's native addon is compiled against this same image in build.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/public/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Versioned migrations, then the server. migrate.cjs is idempotent: a database
# created with an older `drizzle-kit push` is journaled and left intact.
CMD ["sh", "-c", "node dist/migrate.cjs && node dist/index.cjs"]
