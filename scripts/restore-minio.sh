#!/bin/bash
# ============================================================
# scripts/restore-minio.sh
# Restore MinIO bucket from a local backup snapshot.
#
# Usage:
#   # Restore from latest snapshot (auto-detected via symlink):
#   ./scripts/restore-minio.sh
#
#   # Restore from a specific snapshot directory:
#   ./scripts/restore-minio.sh /backups/minio/dharma-evidence_20240101_120000
#
# ⚠️  WARNING: This mirrors backup → bucket with --overwrite.
#              Files in the bucket that don't exist in the backup
#              will NOT be deleted (safe restore by default).
#              Pass --remove to also delete extra files.
# ============================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
MINIO_HOST="${MINIO_ENDPOINT:-minio}"
MINIO_PORT="${MINIO_API_PORT:-9000}"
MINIO_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET="${MINIO_SECRET_KEY:-minioadmin_change_me}"
BUCKET="${MINIO_BUCKET:-dharma-evidence}"
BACKUP_DIR="${BACKUP_DIR:-/backups/minio}"
REMOVE_EXTRA="${REMOVE_EXTRA:-false}"

MINIO_URL="http://${MINIO_HOST}:${MINIO_PORT}"
LATEST_LINK="${BACKUP_DIR}/${BUCKET}_latest"

# ── Determine restore source ───────────────────────────────────────────────
if [ -n "${1:-}" ] && [ -d "$1" ]; then
  RESTORE_SOURCE="$1"
elif [ -L "${LATEST_LINK}" ] && [ -d "${LATEST_LINK}" ]; then
  RESTORE_SOURCE=$(readlink -f "${LATEST_LINK}")
else
  # Fallback: find most recent snapshot directory
  RESTORE_SOURCE=$(ls -dt "${BACKUP_DIR}/${BUCKET}_"[0-9]* 2>/dev/null | head -n 1 || true)
fi

if [ -z "${RESTORE_SOURCE}" ] || [ ! -d "${RESTORE_SOURCE}" ]; then
  echo "❌ ERROR: No backup snapshot found."
  echo "   Usage: $0 [/path/to/snapshot_directory]"
  echo "   Available snapshots in ${BACKUP_DIR}:"
  ls -d "${BACKUP_DIR}/${BUCKET}_"* 2>/dev/null || echo "   (none)"
  exit 1
fi

FILE_COUNT=$(find "${RESTORE_SOURCE}" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "${RESTORE_SOURCE}" 2>/dev/null | cut -f1)

# ── Confirm ────────────────────────────────────────────────────────────────
echo "============================================="
echo "  Dharma MinIO Restore"
echo "============================================="
echo "  Target  : ${MINIO_URL}/${BUCKET}"
echo "  Source  : ${RESTORE_SOURCE}"
echo "  Files   : ${FILE_COUNT} file(s) (${TOTAL_SIZE})"
echo "  Remove extra: ${REMOVE_EXTRA}"
echo "---------------------------------------------"

if [ "${FORCE_RESTORE:-false}" != "true" ]; then
  read -rp "❓ Type 'yes' to confirm restore: " CONFIRM
  if [ "${CONFIRM}" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
  fi
fi

# ── Configure mc ──────────────────────────────────────────────────────────
echo "⏳ Connecting to MinIO..."
mc alias set dharma-restore "${MINIO_URL}" "${MINIO_KEY}" "${MINIO_SECRET}"

# ── Recreate bucket if needed ─────────────────────────────────────────────
echo "⏳ Ensuring bucket '${BUCKET}' exists..."
mc mb "dharma-restore/${BUCKET}" --ignore-existing

# ── Mirror from backup snapshot to MinIO ──────────────────────────────────
echo "⏳ Uploading ${FILE_COUNT} file(s) to ${MINIO_URL}/${BUCKET}..."

MC_FLAGS="--overwrite --preserve"
if [ "${REMOVE_EXTRA}" = "true" ]; then
  MC_FLAGS="${MC_FLAGS} --remove"
fi

# shellcheck disable=SC2086
mc mirror ${MC_FLAGS} "${RESTORE_SOURCE}" "dharma-restore/${BUCKET}"

echo ""
echo "✅ MinIO restore complete."
echo "   Bucket: ${BUCKET}"
echo "   Files : ${FILE_COUNT} restored"
echo ""
echo "📝 Next steps:"
echo "   1. Verify: mc ls dharma-restore/${BUCKET}"
echo "   2. Restart the Next.js application if needed"
echo "   3. Verify: curl http://localhost:3000/api/status"
