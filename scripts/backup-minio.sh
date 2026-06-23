#!/bin/bash
# ============================================================
# scripts/backup-minio.sh
# MinIO bucket backup using mc mirror.
#
# Mirrors: minio/<MINIO_BUCKET> → /backups/minio/<MINIO_BUCKET>
#
# Environment variables (all optional – have safe defaults):
#   MINIO_ENDPOINT   (default: minio)
#   MINIO_API_PORT   (default: 9000)
#   MINIO_ACCESS_KEY (default: minioadmin)
#   MINIO_SECRET_KEY (default: minioadmin_change_me)
#   MINIO_BUCKET     (default: dharma-evidence)
#   BACKUP_DIR       (default: /backups/minio)
#   BACKUP_RETENTION_DAYS (default: 7)
#
# Usage:
#   ./scripts/backup-minio.sh
# ============================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
MINIO_HOST="${MINIO_ENDPOINT:-minio}"
MINIO_PORT="${MINIO_API_PORT:-9000}"
MINIO_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET="${MINIO_SECRET_KEY:-minioadmin_change_me}"
BUCKET="${MINIO_BUCKET:-dharma-evidence}"
BACKUP_DIR="${BACKUP_DIR:-/backups/minio}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

MINIO_URL="http://${MINIO_HOST}:${MINIO_PORT}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_DIR="${BACKUP_DIR}/${BUCKET}_${TIMESTAMP}"
LATEST_LINK="${BACKUP_DIR}/${BUCKET}_latest"

# ── Setup ──────────────────────────────────────────────────────────────────
mkdir -p "${SNAPSHOT_DIR}"

echo "============================================="
echo "  Dharma MinIO Backup"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "============================================="
echo "  Source  : ${MINIO_URL}/${BUCKET}"
echo "  Output  : ${SNAPSHOT_DIR}"
echo "  Retain  : ${RETENTION_DAYS} days"
echo "---------------------------------------------"

# ── Wait for MinIO readiness ───────────────────────────────────────────────
echo "⏳ Checking MinIO connectivity..."
until mc alias set dharma-backup "${MINIO_URL}" "${MINIO_KEY}" "${MINIO_SECRET}" > /dev/null 2>&1; do
  echo "   MinIO not ready, retrying in 5s..."
  sleep 5
done
echo "✅ MinIO connection established."

# ── Mirror bucket to local snapshot directory ──────────────────────────────
echo "⏳ Mirroring bucket to ${SNAPSHOT_DIR}..."
mc mirror \
  --overwrite \
  --preserve \
  "dharma-backup/${BUCKET}" \
  "${SNAPSHOT_DIR}"

# ── Verify ─────────────────────────────────────────────────────────────────
FILE_COUNT=$(find "${SNAPSHOT_DIR}" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "${SNAPSHOT_DIR}" 2>/dev/null | cut -f1)

if [ "${FILE_COUNT}" -eq "0" ]; then
  echo "⚠️  WARNING: No files found in bucket (bucket may be empty)."
else
  echo "✅ Mirrored ${FILE_COUNT} file(s) (${TOTAL_SIZE})."
fi

# ── Update 'latest' symlink ────────────────────────────────────────────────
rm -f "${LATEST_LINK}"
ln -s "${SNAPSHOT_DIR}" "${LATEST_LINK}"
echo "🔗 Updated symlink: ${LATEST_LINK} → ${SNAPSHOT_DIR}"

# ── Retention: remove snapshot directories older than RETENTION_DAYS ───────
echo "🧹 Cleaning up snapshots older than ${RETENTION_DAYS} days..."
DELETED=$(find "${BACKUP_DIR}" -maxdepth 1 -name "${BUCKET}_[0-9]*" -type d -mtime "+${RETENTION_DAYS}" -print -exec rm -rf {} + 2>/dev/null | wc -l | tr -d ' ' || echo "0")
echo "   Deleted ${DELETED} old snapshot(s)."

# ── List current snapshots ─────────────────────────────────────────────────
echo ""
echo "📦 Current MinIO snapshots:"
ls -lh "${BACKUP_DIR}" 2>/dev/null | grep "${BUCKET}_" || echo "   (none)"

echo ""
echo "✅ MinIO backup complete."
