#!/bin/bash
# ============================================================
# scripts/backup-pg.sh
# PostgreSQL backup using pg_dump.
#
# Produces: /backups/pg/dharma_YYYYMMDD_HHMMSS.sql.gz
#
# Environment variables (all optional – have safe defaults):
#   POSTGRES_HOST     (default: postgres)
#   POSTGRES_PORT     (default: 5432)
#   POSTGRES_USER     (default: dharma)
#   POSTGRES_PASSWORD (default: dharmapass)
#   POSTGRES_DB       (default: dharma_db)
#   BACKUP_DIR        (default: /backups/pg)
#   BACKUP_RETENTION_DAYS (default: 7)
#
# Usage:
#   ./scripts/backup-pg.sh
#   BACKUP_DIR=/my/path ./scripts/backup-pg.sh
# ============================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
PG_HOST="${POSTGRES_HOST:-postgres}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-dharma}"
PG_PASSWORD="${POSTGRES_PASSWORD:-dharmapass}"
PG_DB="${POSTGRES_DB:-dharma_db}"
BACKUP_DIR="${BACKUP_DIR:-/backups/pg}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dharma_${TIMESTAMP}.sql.gz"

# ── Setup ──────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

echo "============================================="
echo "  Dharma PostgreSQL Backup"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "============================================="
echo "  Host    : ${PG_HOST}:${PG_PORT}"
echo "  Database: ${PG_DB}"
echo "  Output  : ${BACKUP_FILE}"
echo "  Retain  : ${RETENTION_DAYS} days"
echo "---------------------------------------------"

# ── Run pg_dump ────────────────────────────────────────────────────────────
export PGPASSWORD="${PG_PASSWORD}"

pg_dump \
  --host="${PG_HOST}" \
  --port="${PG_PORT}" \
  --username="${PG_USER}" \
  --dbname="${PG_DB}" \
  --format=plain \
  --no-password \
  --verbose \
  2>&1 | tee >(grep -v "^$" >&2) \
  | gzip -9 > "${BACKUP_FILE}"

unset PGPASSWORD

# ── Verify ─────────────────────────────────────────────────────────────────
if [ ! -f "${BACKUP_FILE}" ] || [ ! -s "${BACKUP_FILE}" ]; then
  echo "❌ ERROR: Backup file is missing or empty: ${BACKUP_FILE}"
  exit 1
fi

FILE_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "✅ Backup created: ${BACKUP_FILE} (${FILE_SIZE})"

# ── Retention: remove backups older than RETENTION_DAYS ───────────────────
echo "🧹 Cleaning up backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "${BACKUP_DIR}" -name "dharma_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')
echo "   Deleted ${DELETED} old backup(s)."

# ── List current backups ───────────────────────────────────────────────────
echo ""
echo "📦 Current backups in ${BACKUP_DIR}:"
ls -lh "${BACKUP_DIR}"/dharma_*.sql.gz 2>/dev/null || echo "   (none)"

echo ""
echo "✅ PostgreSQL backup complete."
