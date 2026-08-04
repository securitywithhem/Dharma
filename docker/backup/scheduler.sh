#!/bin/bash
# ============================================================
# docker/backup/scheduler.sh
#
# Runs scripts/backup-all.sh once per day at BACKUP_AT_UTC (HH:MM, default
# 02:00), then reports the outcome durably.
#
# Deliberately a sleep loop rather than cron: cron in a container needs its
# own env plumbing (it wipes the environment), writes to its own log, and
# swallows exit codes — three ways for a backup to fail invisibly, which is
# the failure mode this whole service exists to end. A loop keeps the exit
# code, logs to the container's stdout where compose already captures it,
# and is readable by whoever is debugging it at 3am.
# ============================================================

set -uo pipefail

BACKUP_AT_UTC="${BACKUP_AT_UTC:-02:00}"
ALERT_URL="${BACKUP_ALERT_WEBHOOK_URL:-}"
STATE_DIR="${BACKUP_DIR:-/backups}"

log() { echo "[backup-scheduler $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

# Emit a machine-readable record next to the backups themselves, so the
# outcome survives container restarts and log rotation. /api/health surfaces
# this file (see src/app/api/health/route.ts) which is what makes a silently
# dead scheduler visible instead of merely logged.
record_result() {
  local status="$1" detail="$2"
  mkdir -p "${STATE_DIR}"
  cat > "${STATE_DIR}/last-run.json" <<EOF
{
  "status": "${status}",
  "finishedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "detail": "${detail}"
}
EOF
}

# Best-effort out-of-band alert. Never allowed to fail the run itself — a
# broken webhook must not mask a successful backup, or vice versa.
alert() {
  local text="$1"
  [ -z "${ALERT_URL}" ] && return 0
  curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":$(printf '%s' "${text}" | sed 's/"/\\"/g; s/^/"/; s/$/"/')}" \
    "${ALERT_URL}" >/dev/null 2>&1 \
    && log "alert delivered" \
    || log "WARNING: alert delivery failed (backup outcome above is still authoritative)"
}

run_backup() {
  log "starting backup run"
  if bash /scripts/backup-all.sh; then
    log "backup run SUCCEEDED"
    record_result "ok" "backup-all.sh exited 0"
  else
    local rc=$?
    log "CRITICAL: backup run FAILED (exit ${rc})"
    record_result "failed" "backup-all.sh exited ${rc}"
    alert "CRITICAL: Dharma backup FAILED (exit ${rc}) at $(date -u '+%Y-%m-%dT%H:%M:%SZ'). Postgres and/or MinIO backup did not complete."
  fi
}

# RUN_BACKUP_NOW=true runs one backup immediately and exits — this is the
# entrypoint for the restore drill and for manual "back up before I do
# something risky" runs.
if [ "${RUN_BACKUP_NOW:-false}" = "true" ]; then
  run_backup
  exit $?
fi

log "scheduler started; daily backup at ${BACKUP_AT_UTC} UTC"

while true; do
  now=$(date -u +%s)
  today_target=$(date -u -d "today ${BACKUP_AT_UTC}" +%s 2>/dev/null)
  if [ -z "${today_target}" ]; then
    log "FATAL: BACKUP_AT_UTC='${BACKUP_AT_UTC}' is not a valid HH:MM"
    exit 1
  fi
  if [ "${today_target}" -le "${now}" ]; then
    target=$(date -u -d "tomorrow ${BACKUP_AT_UTC}" +%s)
  else
    target="${today_target}"
  fi
  sleep_for=$((target - now))
  log "next run in ${sleep_for}s"
  sleep "${sleep_for}"
  run_backup
done
