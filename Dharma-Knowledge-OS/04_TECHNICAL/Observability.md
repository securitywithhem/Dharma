---
title: Observability
folder: 04_TECHNICAL
tags: [dharma, technical, observability, monitoring, opentelemetry]
source_docs: [docker-compose.yml, monitoring/, src/lib/observability/]
last_updated: 2026-08-04
status: reviewed
---

# Observability

A metrics stack shipped alongside the billing work and had no vault node until this audit. It is entirely self-hosted, consistent with [[Product_Principles]] — no SaaS APM, nothing leaving the deployment.

## Components (in `docker-compose.yml`)

| Service | Role |
|---|---|
| `prometheus` | Scrape + store, 15s interval |
| `grafana` | Visualisation, provisioned from files (not clicked together in the UI) |
| `otel-collector` | OTLP/HTTP receiver on `:4318`, re-exports metrics on `:8889` for Prometheus to scrape |
| `postgres-exporter` | Postgres metrics (`:9187`) |
| `redis-exporter` | Redis metrics (`:9121`) |
| `blackbox-exporter` | Synthetic probes (`:9115`) |

Config is version-controlled under `monitoring/`: `prometheus.yml`, `blackbox.yml`, `otel-collector.yaml`, `ofelia.ini` (drives the `backup-scheduler`), and Grafana provisioning for both the Prometheus datasource and a `dharma-overview` dashboard.

## How application telemetry reaches Prometheus

Next.js and the worker do **not** expose a `/metrics` endpoint. They push OTLP to the collector (`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`), which converts to the Prometheus exposition format on `:8889`; Prometheus scrapes the collector. Traces are received but currently go to the collector's `debug` exporter only — **there is no trace backend**, so traces are not queryable.

Scrape jobs: `prometheus`, `postgres`, `redis`, `otel-collector`, `minio`, `caddy`, and an `ollama_probe` routed through `blackbox-exporter`'s `http_2xx` module against `/api/version` (Ollama exposes no Prometheus metrics of its own, so liveness is probed rather than scraped).

## Application instrumentation

`src/lib/observability/metrics.ts` defines custom instruments over `@opentelemetry/api`. Two properties are load-bearing and worth not regressing:

- **Instruments are created lazily, on first record.** The OTel metrics API has no proxy provider, so an instrument built at module-import time — before `NodeSDK.start()` registers the global `MeterProvider` — would stay bound to the no-op meter permanently.
- **When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (dev, tests) every call is a free no-op**, so call sites need no `if (enabled)` guards.

## Gaps

- **No alerting.** `alertmanager` is commented out in `prometheus.yml` and no alert rules exist. The stack can show a problem on a dashboard; it cannot tell anyone about one.
- **No trace backend** (see above).
- **No healthchecks on the observability services themselves**, nor on the workers — see [[Deployment]]. A crashed exporter presents as a silent gap in a graph.
- **No SLOs.** [[Acceptance_Criteria]] states latency targets (<200ms API, <50ms pgvector search) that this stack could now measure, but nothing asserts them.

Related: [[Deployment]], [[System_Architecture]], [[Acceptance_Criteria]], [[Development_Status]].
