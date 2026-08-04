#!/usr/bin/env bash
#
# scripts/setup-ollama.sh — idempotently pull the models the AI Advisor needs.
#
# The docker-compose `ollama-init` service does this for the docker profile.
# This script is the equivalent for a local (non-docker) Ollama, which is what
# `npm run dev` talks to by default, and is safe to re-run: /api/pull is a
# no-op for a model that is already present.
#
# Usage: ./scripts/setup-ollama.sh
set -euo pipefail

BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
# Keep this default in step with DEFAULT_EMBEDDING_MODEL in
# src/server/ai/embeddingModels.ts. It must be a 384-dimension model, because
# every pgvector column in this schema is vector(384).
EMBEDDING_MODEL="${OLLAMA_MODEL_EMBEDDING:-all-minilm}"
LLM_MODEL="${OLLAMA_MODEL_LLM:-llama3:8b}"

if ! curl -sf --max-time 5 "${BASE_URL}/api/tags" >/dev/null; then
  echo "✗ Ollama is not reachable at ${BASE_URL}."
  echo "  Start it with 'ollama serve', or bring up the docker profile:"
  echo "    docker compose --env-file envs/.env.docker up -d ollama ollama-init"
  exit 1
fi

pull() {
  echo "⏳ Pulling ${1} …"
  curl -sf -X POST "${BASE_URL}/api/pull" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"${1}\"}" >/dev/null
  echo "✅ ${1} ready."
}

pull "${EMBEDDING_MODEL}"
pull "${LLM_MODEL}"

echo
echo "Installed models:"
curl -s "${BASE_URL}/api/tags" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sed 's/^/  - /'
