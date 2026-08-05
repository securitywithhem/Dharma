#!/usr/bin/env bash
#
# scripts/setup-test-db.sh — create and migrate the isolated test database.
#
# The jest integration suites and the Playwright E2E suite create real rows
# through Prisma. They used to share DATABASE_URL with envs/.env.development,
# so every run left its fixtures behind in the development database — 190+
# orphan organizations, duplicate scheduled reports, stray endpoints and API
# keys, and integration tests that failed on their own accumulated rows.
#
# envs/.env.test now points at `dharma_test`. This script creates it (idempotent)
# and syncs the schema. Run it once per machine, and again after a schema change.
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-dharma-postgres}"
DB_USER="${POSTGRES_USER:-dharma}"
TEST_DB="${TEST_DB_NAME:-dharma_test}"

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "✗ Postgres container '${CONTAINER}' is not running. Start it with: npm run docker:up"
  exit 1
fi

echo "⏳ Ensuring database '${TEST_DB}' exists…"
docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'" | grep -q 1 \
  || docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE ${TEST_DB} OWNER ${DB_USER};"

# pgvector must exist before `prisma db push` creates the vector(384) columns.
docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${TEST_DB}" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

echo "⏳ Syncing schema…"
# --accept-data-loss: this script exists to be re-run after a schema change, and
# any change that drops a column (e.g. the Stripe removal in 07d6db4) otherwise
# halts it with a data-loss prompt. dharma_test holds only disposable fixtures —
# the guard that matters is that TEST_DB is never dharma_db, which the CREATE
# DATABASE above and envs/.env.test together enforce.
npx dotenv -e envs/.env.test -- npx prisma db push --schema packages/db/schema.prisma --skip-generate --accept-data-loss

echo "✅ '${TEST_DB}' ready. 'npm run test' and 'npm run test:e2e' will no longer touch dharma_db."
