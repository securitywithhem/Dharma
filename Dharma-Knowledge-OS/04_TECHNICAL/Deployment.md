---
title: Deployment
folder: 04_TECHNICAL
tags: [dharma, technical, deployment, docker]
source_docs: [2_TRD.md, docker-compose.yml]
last_updated: 2026-07-23
status: draft
---

# Deployment

## Documented (TRD Section 6)

Single `docker-compose.yml` orchestrating: `caddy` (TLS termination/routing), `nextjs`, `postgres` (pgvector-preloaded image), `redis`, `minio`, `ollama`. Vector indexes (`HNSW`, cosine ops) are created via custom migration SQL, not Prisma-managed, since Prisma can't express `pgvector` index types natively.

## Confirmed to exist but not yet ingested into this vault (gap)

Root-level docs not yet read into this knowledge base: `CONTAINERIZATION_STRATEGY.md`, `DEPLOYMENT_RUNBOOK.md`, `DEVOPS_ARCHITECTURE.md`, `DEVOPS_QUICKSTART.md`, plus a live `docker-compose.yml` (22KB — far larger than the TRD's 6-service sketch), `k8s/` and `helm/` directories, suggesting production deployment has moved beyond single-host Docker Compose toward Kubernetes. This note should be revisited by ingesting those docs directly rather than guessing at their content.

## Open Questions

- Is Kubernetes (`k8s/`, `helm/`) the production deployment target, with Docker Compose reserved for local self-hosting? Unconfirmed.
- Backup strategy (PRD/TRD mention a "Backup Scheduler" service in the README's architecture diagram, backing up Postgres + MinIO) — not detailed here; see `DEPLOYMENT_RUNBOOK.md`.

Related: [[System_Architecture]], [[Development_Status]].
