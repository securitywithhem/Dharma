#!/bin/bash
# ============================================================
# scripts/init-ollama.sh
# Pulls required Ollama models from the Ollama registry.
# Runs after Ollama is healthy.
# ============================================================

set -euo pipefail

OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
OLLAMA_MODEL_LLM="${OLLAMA_MODEL_LLM:-llama3:8b}"
OLLAMA_MODEL_EMBEDDING="${OLLAMA_MODEL_EMBEDDING:-nomic-embed-text}"

echo "⏳ Waiting for Ollama to be ready at ${OLLAMA_BASE_URL}..."
until curl -sf "${OLLAMA_BASE_URL}/api/tags" > /dev/null 2>&1; do
  sleep 5
done
echo "✅ Ollama is ready."

# ── Helper: Pull model if not already present ──────────────────────────────
pull_model() {
  local model="$1"
  echo "⏳ Checking if model '${model}' is already pulled..."

  local existing
  existing=$(curl -sf "${OLLAMA_BASE_URL}/api/tags" | grep -c "\"${model}\"" || true)

  if [ "${existing}" -gt "0" ]; then
    echo "✅ Model '${model}' is already available. Skipping pull."
    return 0
  fi

  echo "⏳ Pulling model '${model}' (this may take a few minutes)..."
  curl -X POST "${OLLAMA_BASE_URL}/api/pull" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${model}\"}" \
    --no-buffer

  echo "✅ Model '${model}' pulled successfully."
}

# ── Pull models ────────────────────────────────────────────────────────────
pull_model "${OLLAMA_MODEL_EMBEDDING}"
pull_model "${OLLAMA_MODEL_LLM}"

echo ""
echo "✅ Ollama model initialization complete."
echo "   LLM: ${OLLAMA_MODEL_LLM}"
echo "   Embeddings: ${OLLAMA_MODEL_EMBEDDING}"

# List available models
echo ""
echo "📋 Available models:"
curl -sf "${OLLAMA_BASE_URL}/api/tags" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//'
