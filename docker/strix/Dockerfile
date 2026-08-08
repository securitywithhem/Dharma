# ---------------------------------------------------------------------------
# WAVE 12 — Strix (Deep Scan) engine host.
#
# Holds the Strix CLI and the Docker client it uses to launch its own sandbox
# containers. This image does NOT do the exploitation itself: Strix spawns
# ghcr.io/usestrix/strix-sandbox as a sibling container and works inside that.
#
# Long-lived on purpose. The alternative — `docker run`-ing Strix per scan, as
# scanner.ts does for nuclei — would re-check (and on a cold cache, re-pull) a
# several-hundred-MB sandbox image on every scan, which reads to the user as a
# hung scan. Keeping it warm also lets the healthcheck answer the question that
# actually matters: is the sandbox image present *now*.
# ---------------------------------------------------------------------------

# Pinned minor, not :latest. Strix requires >=3.12 (upstream pyproject.toml).
FROM python:3.12-slim

# docker-cli only — this container talks to the host daemon over the mounted
# socket and must never run a daemon of its own. curl is used by the
# healthcheck; git lets Strix accept repository targets.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        docker.io \
    && rm -rf /var/lib/apt/lists/*

# Pinned release. An autonomous exploitation agent is the last dependency that
# should change version silently under a running deployment; bumping this is a
# reviewed change, and STRIX_SANDBOX_IMAGE in src/env.ts must move with it.
ARG STRIX_VERSION=0.1.20
RUN pip install --no-cache-dir "strix-agent==${STRIX_VERSION}"

# Run artifacts land here. Mounted as a named volume shared read-only with
# pentest-worker, which reads strix_runs/<run>/vulnerabilities.json directly
# rather than shelling back through `strix view`.
ENV STRIX_RUNS_ROOT=/strix-runs
WORKDIR /strix-runs

COPY docker/strix/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# The container idles; scans arrive as `docker exec … strix …` from the worker.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
