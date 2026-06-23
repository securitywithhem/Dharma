#!/bin/bash
# ============================================================
# scripts/docker-entrypoint.sh
# Dharma main Docker entrypoint for the Next.js container.
# Waits for all dependencies, runs migrations, then starts app.
# ============================================================

set -euo pipefail

echo ""
echo "🚀 ============================================="
echo "   Dharma Docker Entrypoint Starting..."
echo "   NODE_ENV: ${NODE_ENV:-development}"
echo "============================================="
echo ""

# ── Wait helpers ───────────────────────────────────────────────────────────

wait_for_postgres() {
  echo "⏳ Waiting for PostgreSQL (${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432})..."
  until pg_isready \
    -h "${POSTGRES_HOST:-postgres}" \
    -p "${POSTGRES_PORT:-5432}" \
    -U "${POSTGRES_USER:-dharma}" \
    -d "${POSTGRES_DB:-dharma_db}" \
    > /dev/null 2>&1; do
    echo "   PostgreSQL not ready yet. Retrying in 2s..."
    sleep 2
  done
  echo "✅ PostgreSQL is ready."
}

wait_for_redis() {
  echo "⏳ Waiting for Redis (${REDIS_HOST:-redis}:${REDIS_PORT:-6379})..."
  until redis-cli \
    -h "${REDIS_HOST:-redis}" \
    -p "${REDIS_PORT:-6379}" \
    ${REDIS_PASSWORD:+-a "${REDIS_PASSWORD}"} \
    ping > /dev/null 2>&1; do
    echo "   Redis not ready yet. Retrying in 2s..."
    sleep 2
  done
  echo "✅ Redis is ready."
}

wait_for_ollama() {
  echo "⏳ Waiting for Ollama (${OLLAMA_BASE_URL:-http://ollama:11434})..."
  until curl -sf "${OLLAMA_BASE_URL:-http://ollama:11434}/api/tags" > /dev/null 2>&1; do
    echo "   Ollama not ready yet. Retrying in 5s..."
    sleep 5
  done
  echo "✅ Ollama is ready."
}

# ── Run migrations ─────────────────────────────────────────────────────────

run_migrations() {
  echo "🔄 Running Prisma migrations..."
  npx prisma migrate deploy --schema packages/db/schema.prisma
  echo "✅ Prisma migrations applied."
}

# ── Seed database ──────────────────────────────────────────────────────────

run_seed() {
  if [ "${SEED_DATABASE:-false}" = "true" ]; then
    echo "🌱 Seeding database (SEED_DATABASE=true)..."
    npm run seed:all
    echo "✅ Database seeded."
  else
    echo "ℹ️  Skipping database seed (SEED_DATABASE != true)."
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────

main() {
  wait_for_postgres
  wait_for_redis

  # Ollama is optional for the web container; worker handles inference
  if [ "${WAIT_FOR_OLLAMA:-false}" = "true" ]; then
    wait_for_ollama
  fi

  run_migrations
  run_seed

  echo ""
  echo "✨ ============================================="
  echo "   All services ready. Starting application..."
  echo "============================================="
  echo ""

  # Hand off to the actual process (CMD or passed args)
  exec "$@"
}

main "$@"
