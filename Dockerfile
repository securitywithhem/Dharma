# ============================================================
# Dharma — Multi-Stage Production Dockerfile
# Next.js 14 + tRPC + TypeScript
# ============================================================
# Build: docker build -t dharma:latest .
# Run:   docker run -p 3000:3000 dharma:latest
# ============================================================

# Stage 1: Dependencies (cached layer)
FROM node:22-alpine AS deps
WORKDIR /app

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm@10.6.2 && \
    pnpm install --frozen-lockfile && \
    pnpm install -D

# Stage 2: Builder (build application)
FROM node:22-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/pnpm-lock.yaml ./

# Copy source code
COPY . .

# Build Next.js application
RUN npm install -g pnpm@10.6.2 && \
    pnpm prisma generate --schema packages/db/schema.prisma && \
    pnpm build

# Stage 3: Runtime (minimal production image)
FROM node:22-alpine AS runtime
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy necessary files from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Copy environment template
COPY --chown=nextjs:nodejs envs/.env.production.example .env.production.local

# Set ownership
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "server.js"]

# Labels for container metadata
LABEL org.opencontainers.image.title="Dharma"
LABEL org.opencontainers.image.description="Self-hosted compliance management platform"
LABEL org.opencontainers.image.vendor="Dharma"
LABEL org.opencontainers.image.version="1.0.0"
