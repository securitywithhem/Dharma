#!/bin/bash
# ============================================================
# scripts/restore-pg.sh
# Restore PostgreSQL from a .sql.gz backup file.
#
# Usage:
#   # Restore from latest backup (auto-detected):
#   ./scripts/restore-pg.sh
#
#   # Restore from a specific file:
#   ./scripts/restore-pg.sh /backups/pg/dharma_20240101_120000.sql.gz
#
# ⚠️  WARNING: This DROPS and recreates the database.
#              All current data will be lost.
# ============================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
PG_HOST="${POSTGRES_HOST:-postgres}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-dharma}"
PG_PASSWORD="${POSTGRES_PASSWORD:-dharmapass}"
PG_DB="${POSTGRES_DB:-dharma_db}"
BACKUP_DIR="${BACKUP_DIR:-/backups/pg}"

# ── Determine restore file ─────────────────────────────────────────────────
if [ -n "${1:-}" ]; then
  RESTORE_FILE="$1"
else
  # Auto-detect latest backup
  RESTORE_FILE=$(ls -t "${BACKUP_DIR}"/dharma_*.sql.gz 2>/dev/null | head -n 1 || true)
fi

if [ -z "${RESTORE_FILE}" ] || [ ! -f "${RESTORE_FILE}" ]; then
  echo "❌ ERROR: No backup file found."
  echo "   Usage: $0 [/path/to/dharma_YYYYMMDD_HHMMSS.sql.gz]"
  echo "   Available backups in ${BACKUP_DIR}:"
  ls "${BACKUP_DIR}"/dharma_*.sql.gz 2>/dev/null || echo "   (none)"
  exit 1
fi

# ── Confirm ────────────────────────────────────────────────────────────────
echo "============================================="
echo "  Dharma PostgreSQL Restore"
echo "  ⚠️  THIS WILL OVERWRITE ALL EXISTING DATA"
echo "============================================="
echo "  Host    : ${PG_HOST}:${PG_PORT}"
echo "  Database: ${PG_DB}"
echo "  File    : ${RESTORE_FILE} ($(du -sh "${RESTORE_FILE}" | cut -f1))"
echo "---------------------------------------------"

if [ "${FORCE_RESTORE:-false}" != "true" ]; then
  read -rp "❓ Type 'yes' to confirm restore: " CONFIRM
  if [ "${CONFIRM}" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
  fi
fi

export PGPASSWORD="${PG_PASSWORD}"

# ── Drop and recreate database ─────────────────────────────────────────────
echo "⏳ Dropping existing database '${PG_DB}'..."
psql -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PG_DB}' AND pid<>pg_backend_pid();" \
  > /dev/null 2>&1 || true

psql -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${PG_DB}\";" > /dev/null

psql -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d postgres \
  -c "CREATE DATABASE \"${PG_DB}\" OWNER \"${PG_USER}\";" > /dev/null

echo "✅ Database recreated."

# ── Enable required extensions ─────────────────────────────────────────────
echo "⏳ Enabling extensions..."
psql -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
  -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;" \
  > /dev/null

# ── Restore ────────────────────────────────────────────────────────────────
echo "⏳ Restoring from ${RESTORE_FILE}..."
gunzip -c "${RESTORE_FILE}" \
  | psql -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
    --set ON_ERROR_STOP=1 \
    > /dev/null

unset PGPASSWORD

echo "✅ Restore complete."
echo ""
echo "📝 Next steps:"
echo "   1. Run Prisma migrations if needed: npx prisma migrate deploy"
echo "   2. Restart the Next.js application"
echo "   3. Verify data: curl http://localhost:3000/api/status"
