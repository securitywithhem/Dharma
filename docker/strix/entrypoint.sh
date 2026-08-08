#!/bin/sh
# ---------------------------------------------------------------------------
# WAVE 12 — Strix engine host entrypoint.
#
# Pre-pulls the sandbox image, then idles so the worker can `docker exec` scans
# into a warm container.
#
# The pull happens HERE rather than being left to Strix's first run, because
# WAVE 1.4's Ollama defect was exactly that shape: a service reported healthy
# while the model it needed had not been fetched, so the first real request
# looked like a hang instead of a missing dependency. The healthcheck below
# only passes once the image is actually present.
# ---------------------------------------------------------------------------
set -eu

SANDBOX_IMAGE="${STRIX_IMAGE:-ghcr.io/usestrix/strix-sandbox:1.3.0}"

echo "[strix] engine host starting"
echo "[strix] sandbox image: ${SANDBOX_IMAGE}"

if ! docker info >/dev/null 2>&1; then
  echo "[strix] FATAL: cannot reach the Docker daemon."
  echo "[strix] Strix launches its sandbox as a sibling container and cannot run without it."
  echo "[strix] Check that /var/run/docker.sock is mounted into this service."
  exit 1
fi

if docker image inspect "${SANDBOX_IMAGE}" >/dev/null 2>&1; then
  echo "[strix] ✅ sandbox image already present."
else
  echo "[strix] ⏳ pulling sandbox image (first run — this is large and may take several minutes)..."
  if docker pull "${SANDBOX_IMAGE}"; then
    echo "[strix] ✅ sandbox image pulled."
  else
    # Deliberately non-fatal. A registry outage should leave the engine
    # reporting unavailable through engines.status — so the UI disables Deep
    # Scan with a reason — rather than crash-looping the container and taking
    # the operator's attention away from whatever else is wrong.
    echo "[strix] ⚠️  sandbox image pull FAILED. Deep Scan will report unavailable until it succeeds."
  fi
fi

if [ -z "${STRIX_LLM:-}" ]; then
  echo "[strix] ⚠️  STRIX_LLM is not set. Strix is an LLM agent and cannot scan without a model."
  echo "[strix]     Set STRIX_LLM and LLM_API_KEY. Deep Scan will report unavailable until then."
fi

echo "[strix] ready — awaiting scans via docker exec."

# Idle. `tail -f /dev/null` would ignore SIGTERM under PID 1 and force compose
# to wait out its stop timeout on every restart.
trap 'echo "[strix] SIGTERM — shutting down"; exit 0' TERM INT
while true; do
  sleep 3600 &
  wait $!
done
