# ============================================================
# Dockerfile – Backup runner (Postgres + MinIO)
#
# Carries both tools the backup scripts need, in one image:
#   pg_dump  – from the SAME base image as the postgres service, so the
#              client version always matches the server. A version-skewed
#              pg_dump is a classic silent restore breaker.
#   mc       – MinIO client, copied from the official image rather than
#              curl'd at build time so the version is pinned by the tag.
#
# Replaces the previous ofelia scheduler, which exec'd into containers that
# had neither the scripts nor the backup volume mounted, and therefore never
# produced a single backup file. See monitoring/README-backups.md.
# ============================================================

FROM minio/mc:RELEASE.2024-06-12T14-34-03Z AS mc

FROM ankane/pgvector:v0.5.1

COPY --from=mc /usr/bin/mc /usr/local/bin/mc

# tini reaps the sleep/subshell children of the scheduler loop so the
# container stops promptly on `docker compose down` instead of waiting out
# the current sleep interval.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/backup/scheduler.sh /usr/local/bin/scheduler.sh
RUN chmod +x /usr/local/bin/scheduler.sh

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/scheduler.sh"]
