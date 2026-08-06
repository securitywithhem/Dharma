#!/usr/bin/env bash
# scripts/seal-secrets.sh
#
# Interactive helper for docs/ops/secrets-management.md steps 2-4: build a
# plaintext Secret manifest from prompted values, seal it with kubeseal, and
# shred the plaintext. This script never stores, logs, or transmits the
# values you type anywhere except into the sealed (encrypted) output file --
# read it before running it if you want to verify that yourself, that's the
# point of it being a plain bash script and not a black box.
#
# Requires: kubectl (pointed at the target cluster's context), kubeseal.
set -euo pipefail

ENVIRONMENT="${1:-}"
if [[ -z "$ENVIRONMENT" || ! "$ENVIRONMENT" =~ ^(staging|production)$ ]]; then
  echo "Usage: $0 <staging|production>" >&2
  exit 1
fi

NAMESPACE="dharma"
SECRET_NAME="dharma-app-secrets"
OUT_DIR="k8s/sealed"
OUT_FILE="${OUT_DIR}/${SECRET_NAME}.${ENVIRONMENT}.yaml"
PLAINTEXT_TMP="$(mktemp)"
trap 'shred -u "$PLAINTEXT_TMP" 2>/dev/null || rm -f "$PLAINTEXT_TMP"' EXIT

command -v kubectl >/dev/null || { echo "kubectl not found" >&2; exit 1; }
command -v kubeseal >/dev/null || { echo "kubeseal not found -- see docs/ops/secrets-management.md" >&2; exit 1; }

echo "Sealing '${SECRET_NAME}' for '${ENVIRONMENT}' against the CURRENT kubectl context:"
kubectl config current-context
read -rp "Correct cluster? [y/N] " confirm
[[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "Aborted."; exit 1; }

read -rp "Database host[:port] (e.g. postgres:5432): " db_host
read -rsp "Database password (leave blank to generate): " db_pass; echo
db_pass="${db_pass:-$(openssl rand -base64 24)}"

read -rp "Redis host[:port] (e.g. redis:6379): " redis_host
read -rsp "Redis password (leave blank to generate): " redis_pass; echo
redis_pass="${redis_pass:-$(openssl rand -base64 24)}"

read -rp "MinIO endpoint (e.g. minio:9000): " minio_endpoint
read -rp "MinIO access key (leave blank to generate): " minio_access
minio_access="${minio_access:-$(openssl rand -hex 16)}"
read -rsp "MinIO secret key (leave blank to generate): " minio_secret; echo
minio_secret="${minio_secret:-$(openssl rand -base64 24)}"

nextauth_secret="$(openssl rand -base64 32)"

kubectl create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-literal=database-url="postgresql://dharma:${db_pass}@${db_host}/dharma_db?schema=public" \
  --from-literal=redis-url="redis://:${redis_pass}@${redis_host}" \
  --from-literal=minio-endpoint="${minio_endpoint}" \
  --from-literal=minio-access-key="${minio_access}" \
  --from-literal=minio-secret-key="${minio_secret}" \
  --from-literal=nextauth-secret="${nextauth_secret}" \
  --dry-run=client -o yaml > "$PLAINTEXT_TMP"

mkdir -p "$OUT_DIR"
kubeseal --format yaml --namespace "$NAMESPACE" < "$PLAINTEXT_TMP" > "$OUT_FILE"

echo
echo "Sealed secret written to: $OUT_FILE"
echo "Plaintext was held only in memory/a shredded temp file — never written to $OUT_FILE."
echo
echo "Next:"
echo "  git add $OUT_FILE && git commit -m 'chore(secrets): rotate ${ENVIRONMENT} app secret'"
echo "  kubectl apply -f $OUT_FILE"
