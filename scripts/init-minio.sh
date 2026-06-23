#!/bin/bash
# ============================================================
# scripts/init-minio.sh
# MinIO bucket initialization script.
# Standalone – can be run from host OR inside a container that
# has access to the 'minio' Docker network hostname.
# ============================================================

set -euo pipefail

MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_API_PORT="${MINIO_API_PORT:-9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin_change_me}"
MINIO_BUCKET="${MINIO_BUCKET:-dharma-evidence}"
MINIO_REGION="${MINIO_REGION:-us-east-1}"

MINIO_URL="http://${MINIO_ENDPOINT}:${MINIO_API_PORT}"

echo "⏳ Waiting for MinIO to be ready at ${MINIO_URL}..."
until curl -sf "${MINIO_URL}/minio/health/live" > /dev/null 2>&1; do
  sleep 2
done
echo "✅ MinIO is ready."

echo "⏳ Configuring MinIO client (mc)..."
mc alias set dharma-minio "${MINIO_URL}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"

echo "⏳ Creating bucket: ${MINIO_BUCKET}..."
mc mb "dharma-minio/${MINIO_BUCKET}" --ignore-existing

echo "⏳ Enabling versioning on bucket..."
mc version enable "dharma-minio/${MINIO_BUCKET}" || true

echo "⏳ Setting anonymous read policy (disable for production)..."
# In production, remove or restrict this policy
# mc anonymous set none "dharma-minio/${MINIO_BUCKET}"

echo "✅ MinIO initialization complete."
echo "   Bucket: ${MINIO_BUCKET}"
echo "   Console: http://localhost:9001"
