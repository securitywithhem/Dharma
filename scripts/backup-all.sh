#!/bin/bash
# ============================================================
# scripts/backup-all.sh
# Master backup orchestrator – runs PostgreSQL and MinIO backups
# sequentially and reports a combined status.
#
# Usage:
#   ./scripts/backup-all.sh
#   BACKUP_RETENTION_DAYS=14 ./scripts/backup-all.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="${BACKUP_DIR:-/backups}"
LOG_FILE="${BACKUP_ROOT}/backup-all_$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$(dirname "${LOG_FILE}")"

# Give each tool its own subdirectory and stop passing the shared BACKUP_DIR
# straight through. Both child scripts read BACKUP_DIR, so a caller that set
# BACKUP_DIR=/backups (as the scheduler service does) made backup-pg.sh write
# dumps to /backups instead of its documented /backups/pg — restore-pg.sh
# auto-detects the latest backup by globbing /backups/pg and would have found
# nothing, silently "restoring" from an older dump or failing outright.
export PG_BACKUP_DIR="${BACKUP_ROOT}/pg"
export MINIO_BACKUP_DIR="${BACKUP_ROOT}/minio"

# ── Logging helper ─────────────────────────────────────────────────────────
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

log "============================================="
log "  Dharma Master Backup"
log "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
log "============================================="

PG_STATUS=0
MINIO_STATUS=0

# ── PostgreSQL backup ──────────────────────────────────────────────────────
log "▶ Starting PostgreSQL backup..."
if BACKUP_DIR="${PG_BACKUP_DIR}" bash "${SCRIPT_DIR}/backup-pg.sh" 2>&1 | tee -a "${LOG_FILE}"; then
  log "✅ PostgreSQL backup succeeded."
else
  PG_STATUS=$?
  log "❌ PostgreSQL backup FAILED (exit code: ${PG_STATUS})."
fi

echo "" | tee -a "${LOG_FILE}"

# ── MinIO backup ───────────────────────────────────────────────────────────
log "▶ Starting MinIO backup..."
if BACKUP_DIR="${MINIO_BACKUP_DIR}" bash "${SCRIPT_DIR}/backup-minio.sh" 2>&1 | tee -a "${LOG_FILE}"; then
  log "✅ MinIO backup succeeded."
else
  MINIO_STATUS=$?
  log "❌ MinIO backup FAILED (exit code: ${MINIO_STATUS})."
fi

echo "" | tee -a "${LOG_FILE}"

# ── Summary ────────────────────────────────────────────────────────────────
log "============================================="
log "  Backup Summary"
log "============================================="
log "  PostgreSQL : $([ "${PG_STATUS}" -eq 0 ] && echo '✅ OK' || echo '❌ FAILED')"
log "  MinIO      : $([ "${MINIO_STATUS}" -eq 0 ] && echo '✅ OK' || echo '❌ FAILED')"
log "  Log        : ${LOG_FILE}"
log "============================================="

# ── Cleanup old logs (keep 30 days) ───────────────────────────────────────
find "$(dirname "${LOG_FILE}")" -name "backup-all_*.log" -mtime +30 -delete 2>/dev/null || true

# Return non-zero if any backup failed
if [ "${PG_STATUS}" -ne 0 ] || [ "${MINIO_STATUS}" -ne 0 ]; then
  exit 1
fi

log "✅ All backups completed successfully."
