# DHARMA — COMPREHENSIVE DEVOPS & SRE ARCHITECTURE

> ⚠️ **Status: DESIGN / SCAFFOLDING — NOT DEPLOYED OR VALIDATED.** This is a
> proposed strategy plus template manifests. No image has been built from these,
> nothing has been deployed to a cluster, and no readiness percentage here has
> been earned by testing. Treat all "✅" marks as "designed," not "verified."
> The only artifact validated so far is `helm/dharma` (`helm lint` + `helm template` pass).

**Status:** Proposed K8s deployment strategy for Phase 0-9 (templates, untested)
**Scope:** Containerization, Kubernetes, CI/CD, Observability, Secrets, HA/DR
**Date:** 2026-07-15

---

## TABLE OF CONTENTS

1. [PART 1: Phase 0 Baseline Analysis](#part-1-phase-0-baseline-analysis)
2. [PART 2: Containerization Strategy](#part-2-containerization-strategy)
3. [PART 3: Kubernetes Manifests](#part-3-kubernetes-manifests)
4. [PART 4: CI/CD Pipeline](#part-4-cicd-pipeline)
5. [PART 5: Observability Stack](#part-5-observability-stack)
6. [PART 6: Secrets Management](#part-6-secrets-management)
7. [PART 7: Scalability & HA](#part-7-scalability--ha)
8. [PART 8: Backup & Disaster Recovery](#part-8-backup--disaster-recovery)
9. [PART 9: Deployment Runbooks](#part-9-deployment-runbooks)

---

# PART 1: PHASE 0 BASELINE ANALYSIS

## Current Infrastructure State

### ✅ What's Already in Place

**Docker Compose Stack (Production-Ready):**
- ✅ PostgreSQL 15 + pgvector (ankane/pgvector image)
- ✅ Redis 7 Alpine with AOF persistence
- ✅ MinIO object storage with health checks
- ✅ Ollama local LLM service
- ✅ Caddy reverse proxy (SSL termination)
- ✅ Next.js application container
- ✅ BullMQ worker container
- ✅ Health checks on all critical services
- ✅ Resource limits (memory/CPU)
- ✅ Named volumes for persistence
- ✅ Custom network (dharma-network)
- ✅ Environment variable injection

**Features Already Implemented:**
- ✅ Restart policies (on-failure:3)
- ✅ Service dependencies (depends_on)
- ✅ Memory/CPU resource constraints
- ✅ Health check endpoints
- ✅ Data persistence via Docker volumes
- ✅ Redis AOF persistence (--appendonly yes)
- ✅ Network isolation

**Current docker-compose.yml covers:**
```
Core Services:
  ├── postgres (PostgreSQL 15 + pgvector)
  ├── redis (BullMQ job queue)
  ├── minio (S3-compatible storage)
  ├── ollama (Local LLM)
  ├── nextjs (Next.js application)
  ├── worker (BullMQ async workers)
  └── caddy (Reverse proxy + SSL)

Optional Monitoring:
  ├── prometheus (Metrics collection)
  ├── grafana (Dashboards)
  ├── postgres-exporter (PostgreSQL metrics)
  └── redis-exporter (Redis metrics)
```

### ⚠️ Current Gaps (For Production Kubernetes)

| Gap | Current State | Production Requirement |
|-----|---|---|
| **Container Registry** | Using Docker Hub/local | Private ECR/Harbor registry with signing |
| **Image Scanning** | None | Trivy/Snyk scanning in CI/CD |
| **Secrets** | .env files | Sealed Secrets or HashiCorp Vault |
| **Persistent Storage** | Docker volumes (local) | EBS/PV with replication class |
| **Logging** | Container stdout | Centralized (ELK/Loki/Datadog) |
| **Monitoring** | Basic Prometheus/Grafana | Enterprise monitoring + alerting |
| **Tracing** | None | OpenTelemetry/Jaeger |
| **Backup Strategy** | Manual | Automated daily backups + DR testing |
| **Multi-zone HA** | Single node | Multi-zone k8s cluster |
| **Network Policy** | None | CNI with network segmentation |
| **RBAC** | Container user model | K8s RBAC + ServiceAccount |
| **Load Balancing** | Single node | Multi-replica deployments + LB |
| **Ingress** | Caddy in container | K8s Ingress with cert-manager |
| **GitOps** | Manual deployment | ArgoCD for declarative deployments |
| **Disaster Recovery** | Manual | Velero backup + cross-region replication |

---

## DevOps Requirements from Documentation

**From PRD (Product Requirements):**
- ✅ Self-hosted capability (on-premise)
- ✅ Data sovereignty (all data stays local)
- ✅ Fast assessment (<2 hours onboarding)
- ✅ API performance (<200ms)

**From TRD (Technical Requirements):**
- ✅ Docker Compose local deployment
- ✅ PostgreSQL + pgvector
- ✅ Containerized services
- ✅ Security controls + encryption

**New Requirements for Production:**
- Multi-tenancy at infrastructure level (org isolation)
- Compliance audit trails (encrypted, immutable)
- Backup frequency (daily minimum, hourly recommended)
- RPO (Recovery Point Objective): 1 hour
- RTO (Recovery Time Objective): 15 minutes
- Availability target: 99.5% (multi-zone)
- Monitoring: Full observability (metrics, logs, traces)
- Secrets: Encrypted at rest, rotated regularly
- Access control: RBAC + network policies

---

## Deployment Topology

### Development (Current)
```
Single Docker Host
├── docker-compose up
├── All services on localhost
└── Volumes on local disk
```

### Production (Target)
```
Kubernetes Cluster (Multi-zone)
├── Control Plane (3 nodes, multi-zone)
├── Worker Nodes (6+ nodes, auto-scaling)
├── Persistent Storage (EBS/PV with replication)
├── Load Balancer (External)
├── Private ECR/Harbor (Image storage)
├── Sealed Secrets (Encryption)
├── Prometheus + Grafana (Observability)
├── ELK/Loki (Centralized logging)
└── Velero (Backup & DR)
```

---

## High-Level DevOps Strategy

### Phase A: Containerization (Week 1-2)
- [ ] Create optimized multi-stage Dockerfile for Next.js
- [ ] Create Dockerfile for BullMQ worker
- [ ] Set up private ECR/Harbor registry
- [ ] Implement image scanning (Trivy)
- [ ] Docker compose testing

### Phase B: Kubernetes Manifests (Week 3-4)
- [ ] Create Namespace + NetworkPolicy
- [ ] Create StatefulSet for PostgreSQL
- [ ] Create Deployment for Next.js
- [ ] Create Deployment for BullMQ workers
- [ ] Create Services + Ingress
- [ ] PVC + storage classes

### Phase C: CI/CD Pipeline (Week 5)
- [ ] GitHub Actions workflow
- [ ] Build + scan + push to registry
- [ ] Run integration tests in Docker
- [ ] Deploy to staging k8s cluster

### Phase D: Observability (Week 6)
- [x] Prometheus + Grafana (docker-compose `monitoring` profile; k8s stack still pending)
- [ ] Structured logging (ELK/Loki)
- [x] OpenTelemetry instrumentation (app + worker emit OTLP traces/metrics when
      `OTEL_EXPORTER_OTLP_ENDPOINT` is set; collector→Prometheus pipeline verified
      locally end-to-end — see `src/lib/observability/` and
      `monitoring/otel-collector.yaml`). Trace BACKEND (Jaeger/Tempo) still pending.
- [ ] Alert rules

### Phase E: Secrets & Security (Week 7)
- [ ] Sealed Secrets / Vault setup
- [ ] Encrypt database credentials
- [ ] API key rotation
- [ ] Network policies

### Phase F: HA & Scaling (Week 8)
- [ ] Horizontal Pod Autoscaling
- [ ] Pod Disruption Budgets
- [ ] Multi-zone deployment
- [ ] Load testing

### Phase G: Backup & DR (Week 9)
- [ ] Velero backup setup
- [ ] Cross-region replication
- [ ] DR testing
- [ ] Runbooks

---

## Technology Choices

### Infrastructure
- **Orchestration:** Kubernetes (EKS, GKE, or self-hosted kubeadm)
- **Container Runtime:** containerd (or Docker)
- **Networking:** Cilium CNI (observability + security)

### Storage
- **Persistent Volumes:** EBS (AWS) / GCP Persistent Disk / NFS
- **Object Storage:** MinIO (in-cluster) or S3
- **Database:** PostgreSQL 15 (managed RDS or StatefulSet)

### Observability
- **Metrics:** Prometheus + Grafana
- **Logs:** Loki + Promtail (or ELK)
- **Tracing:** Jaeger + OpenTelemetry SDKs
- **Alerting:** PrometheusAlert + PagerDuty

### Security
- **Secrets:** Sealed Secrets (Bitnami) or Vault
- **RBAC:** Kubernetes RBAC + OpenPolicyAgent
- **Network:** Cilium NetworkPolicy
- **Image Scanning:** Trivy + Snyk

### GitOps
- **Deployment:** ArgoCD (declarative)
- **Policy:** Kyverno (policy as code)
- **Backup:** Velero

### CI/CD
- **Platform:** GitHub Actions (or GitLab CI)
- **Artifact Registry:** ECR/Harbor
- **Testing:** Jest + Playwright + k3d (local k8s)

---

## SLO & SLA Targets

| Metric | Target | Monitoring |
|--------|--------|-----------|
| **Uptime** | 99.5% | Synthetic monitoring + k8s status |
| **API Latency (p99)** | <500ms | Prometheus + APM |
| **Database Query (p99)** | <100ms | pg_stat_statements + Prometheus exporter |
| **Worker Job (p99)** | <30s | BullMQ UI + Prometheus |
| **Page Load (First Contentful Paint)** | <2s | Datadog RUM / Prometheus |
| **Error Rate** | <0.1% | Application logs + Sentry/Datadog |
| **Backup Success Rate** | 100% | Velero alerts |
| **Backup Frequency** | Every 1 hour | Velero schedule |
| **RTO (Recovery Time Objective)** | 15 minutes | DR testing |
| **RPO (Recovery Point Objective)** | 1 hour | Backup frequency |

---

## Next Steps

This document continues in PART 2 with detailed containerization strategies, followed by complete Kubernetes manifests, CI/CD pipelines, and operational runbooks.

**Proceed to:** [PART 2: Containerization Strategy](#part-2-containerization-strategy)
