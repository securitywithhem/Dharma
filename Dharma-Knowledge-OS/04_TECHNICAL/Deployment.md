---
title: Deployment
folder: 04_TECHNICAL
tags: [dharma, technical, deployment, docker]
source_docs: [2_TRD.md, docker-compose.yml, README.md, monitoring/, k8s/, helm/]
last_updated: 2026-08-04
status: draft
---

# Deployment

## Documented (TRD Section 6)

Single `docker-compose.yml` orchestrating: `caddy` (TLS termination/routing), `nextjs`, `postgres` (pgvector-preloaded image), `redis`, `minio`, `ollama`. Vector indexes (`HNSW`, cosine ops) are created via custom migration SQL, not Prisma-managed, since Prisma can't express `pgvector` index types natively.

## Live Docker Compose (verified against `docker-compose.yml`, 700 lines)

The TRD's 6-service sketch has grown to **17 services**, in four groups:

- **Core** — `caddy`, `nextjs`, `postgres`, `redis`, `minio`, `ollama`.
- **Init/one-shot** — `minio-init`, `ollama-init` (bucket creation, model pull).
- **Workers** — `worker` (the shared BullMQ worker) and `pentest-worker`, split so only the latter holds the host Docker socket. See [[Development_Status]].
- **Operations** — `backup-scheduler`, plus a full observability stack: `prometheus`, `grafana`, `otel-collector`, `blackbox-exporter`, `postgres-exporter`, `redis-exporter`. Config lives under `monitoring/` (`prometheus.yml`, `blackbox.yml`, `otel-collector.yaml`, `ofelia.ini`, Grafana provisioning + a `dharma-overview` dashboard).

**Healthchecks are defined on 8 of 17 services**: `postgres`, `redis`, `minio`, `ollama`, `nextjs`, `caddy`, `prometheus`, `grafana`. The workers, exporters, collector and backup scheduler have none — a container that has crashed into a restart loop is not distinguishable from a healthy one by `docker compose ps` alone.

Environment files live in `envs/` (`.env.development`, `.env.docker`, `.env.production`, `.env.staging`, `.env.test`, plus `.env.example` and `.env.docker.example`), loaded by `dotenv-cli` in the npm scripts rather than by ambient shell env. Setup is documented step-by-step in the root `README.md` (§ "Complete Local Setup Guide") — prerequisites, `docker compose up`, `db:push`, `seed:all`, and optional billing provider keys.

## Open Questions

- Is Kubernetes (`k8s/`, `helm/`) the production deployment target, with Docker Compose reserved for local self-hosting? Still unconfirmed — `k8s/` holds manifests for namespace, postgres, redis, nextjs, minio/ollama/worker, ingress and a secrets template, and `helm/dharma` exists, but nothing in the repo states which is authoritative for production.
- Backup strategy: a `backup-scheduler` service is present in Compose (Ofelia-driven, `monitoring/ofelia.ini`); its retention/restore procedure is not documented anywhere in the repo.
- The four DevOps docs an earlier revision of this note listed as "confirmed to exist" — `CONTAINERIZATION_STRATEGY.md`, `DEPLOYMENT_RUNBOOK.md`, `DEVOPS_ARCHITECTURE.md`, `DEVOPS_QUICKSTART.md` — **do not exist in the repo**. There is no deployment runbook or incident-response doc; [[Threat_Model]] depends on one.

Related: [[System_Architecture]], [[Development_Status]], [[Observability]], [[Threat_Model]].
