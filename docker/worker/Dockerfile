# ============================================================
# Dockerfile – BullMQ Background Worker (Moved to docker/worker/)
# Runs the evidence classification and policy generation queues.
# ============================================================

FROM node:20-alpine AS deps

WORKDIR /app

RUN apk add --no-cache \
    libc6-compat \
    python3 \
    make \
    g++

COPY package.json package-lock.json ./
COPY packages/db/schema.prisma ./packages/db/schema.prisma

RUN npm ci --ignore-scripts
RUN npx prisma generate --schema packages/db/schema.prisma

# ── Production image ──────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install runtime dependencies (curl for healthchecks, bash for entrypoint)
RUN apk add --no-cache \
    libc6-compat \
    curl \
    bash

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S worker  -u 1001 -G nodejs

COPY --from=deps --chown=worker:nodejs /app/node_modules      ./node_modules
COPY --from=deps --chown=worker:nodejs /app/packages          ./packages
COPY --chown=worker:nodejs package.json                        ./package.json
COPY --chown=worker:nodejs src/workers                         ./src/workers
COPY --chown=worker:nodejs src/server                          ./src/server
COPY --chown=worker:nodejs src/env.ts                          ./src/env.ts
COPY --chown=worker:nodejs tsconfig.json                       ./tsconfig.json

USER worker

# Workers don't expose ports – they only consume from Redis queues
# No HEALTHCHECK needed here; worker health is monitored via BullMQ board

CMD ["npx", "tsx", "src/workers/classification.ts"]
