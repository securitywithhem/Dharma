#!/usr/bin/env bash
# ==============================================================================
# validate-docker-env.sh
# Prevents startup if critical secrets are missing, insecure, or match the default placeholders.
# ==============================================================================

set -e

ENV_FILE="envs/.env.docker"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ ERROR: Configuration file $ENV_FILE not found!"
    echo "👉 Action: Run 'cp envs/.env.docker.example $ENV_FILE' and configure your secrets."
    exit 1
fi

# Load variables (ignoring comments)
set -a
source "$ENV_FILE"
set +a

ERRORS=0

function check_secret() {
    local var_name=$1
    local value="${!var_name}"

    if [ -z "$value" ]; then
        echo "❌ ERROR: $var_name is missing or empty."
        ERRORS=1
    elif [[ "$value" == TODO_* ]] || [[ "$value" == *change_me* ]] || [[ "$value" == *change-me* ]] || [[ "$value" == "dharmapass" ]] || [[ "$value" == "redispass" ]]; then
        echo "❌ ERROR: $var_name is using an insecure default or placeholder ('$value')."
        ERRORS=1
    fi
}

check_secret POSTGRES_PASSWORD
check_secret REDIS_PASSWORD
check_secret MINIO_SECRET_KEY
check_secret NEXTAUTH_SECRET
check_secret GRAFANA_ADMIN_PASSWORD

# Check NEXTAUTH_SECRET length (min 32 chars recommended by NextAuth)
if [ ${#NEXTAUTH_SECRET} -lt 32 ] && [[ "$NEXTAUTH_SECRET" != TODO_* ]]; then
    echo "❌ ERROR: NEXTAUTH_SECRET must be at least 32 characters long (current length: ${#NEXTAUTH_SECRET})."
    ERRORS=1
fi

if [ $ERRORS -ne 0 ]; then
    echo ""
    echo "🚨 Security validation failed. Please update your $ENV_FILE and try again."
    exit 1
fi

echo "✅ Environment validation passed."
exit 0
