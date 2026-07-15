# DHARMA DEVOPS — QUICKSTART GUIDE

**Complete production-ready Kubernetes deployment infrastructure for Dharma**

---

## 📦 What's Included

### ✅ Infrastructure as Code
```
Dockerfile                          → Multi-stage Next.js container image
k8s/namespace.yaml                  → Namespace + NetworkPolicy + ResourceQuota
k8s/postgres.yaml                   → PostgreSQL 15 StatefulSet + pgvector
k8s/nextjs.yaml                     → Next.js Deployment + HPA + PDB
k8s/redis.yaml                      → Redis Deployment for BullMQ
k8s/minio-ollama-worker.yaml        → MinIO, Ollama, BullMQ workers
k8s/ingress.yaml                    → Ingress + TLS via cert-manager
k8s/secrets.yaml.template           → Secrets template (use Sealed Secrets)
```

### ✅ CI/CD Automation
```
.github/workflows/deploy.yml        → Full GitHub Actions pipeline
  ├── Lint + typecheck
  ├── Unit + integration tests
  ├── Build + scan Docker image (Trivy)
  ├── Push to registry
  ├── Deploy to staging (develop branch)
  ├── Deploy to production (main branch)
  └── Smoke tests + Slack notifications
```

### ✅ Operations & Runbooks
```
DEVOPS_ARCHITECTURE.md              → Strategic DevOps design document
DEPLOYMENT_RUNBOOK.md               → Complete operational guide
  ├── Cluster setup instructions
  ├── Staging deployment procedure
  ├── Production deployment (with backup)
  ├── Scaling operations
  ├── Backup & disaster recovery
  ├── Monitoring & alerting
  └── Troubleshooting guide
```

---

## 🚀 QUICK START (5 Steps)

### Step 1: Prerequisites

```bash
# Install tools
brew install kubectl helm aws-cli

# Configure AWS credentials
aws configure

# Create EKS cluster (or use existing)
eksctl create cluster --name dharma-prod --region us-east-1 --version 1.29

# Get kubeconfig
aws eks update-kubeconfig --region us-east-1 --name dharma-prod
```

### Step 2: Install Add-ons

```bash
# Install ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# Install cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace --set installCRDs=true

# Install metrics-server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### Step 3: Create Secrets

```bash
# Generate passwords
POSTGRES_PASSWORD=$(openssl rand -base64 32)
REDIS_PASSWORD=$(openssl rand -base64 32)

# Create secrets
kubectl create secret generic postgres-secret \
  --from-literal=username=dharma \
  --from-literal=password=$POSTGRES_PASSWORD \
  --from-literal=database=dharma_db \
  --from-literal=connection-url="postgresql://dharma:$POSTGRES_PASSWORD@postgres.dharma.svc.cluster.local:5432/dharma_db" \
  -n dharma --dry-run=client -o yaml | kubeseal -f - > k8s/postgres-sealed.yaml

kubectl apply -f k8s/postgres-sealed.yaml
# Repeat for redis-secret, minio-secret, nextjs-secret
```

### Step 4: Deploy Services

```bash
# Deploy namespace + network policies
kubectl apply -f k8s/namespace.yaml

# Deploy PostgreSQL
kubectl apply -f k8s/postgres.yaml
kubectl rollout status statefulset/postgres -n dharma --timeout=5m

# Deploy Redis
kubectl apply -f k8s/redis.yaml
kubectl rollout status deployment/redis -n dharma --timeout=3m

# Deploy Next.js + workers + storage
kubectl apply -f k8s/nextjs.yaml
kubectl apply -f k8s/minio-ollama-worker.yaml
kubectl apply -f k8s/ingress.yaml

# Verify
kubectl get pods -n dharma
```

### Step 5: Configure GitHub Actions

```bash
# Add secrets to GitHub repository
# Settings → Secrets and variables → Actions → New repository secret

# Required secrets:
KUBE_CONFIG_STAGING     # Base64 encoded staging kubeconfig
KUBE_CONFIG_PRODUCTION  # Base64 encoded production kubeconfig
SLACK_WEBHOOK_URL       # Slack webhook for notifications
```

**That's it! Your app is deployed.** Push to `main` branch to trigger production deployment.

---

## 🏗️ ARCHITECTURE OVERVIEW

### Kubernetes Topology

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS EKS Cluster                          │
│                 (Multi-zone, Multi-AZ)                      │
└─────────────────────────────────────────────────────────────┘
         │
         ├─ Control Plane (AWS managed)
         │
         └─ Worker Nodes
            ├─ dharma namespace
            │  ├─ Deployments
            │  │  ├─ nextjs (3 replicas, HPA 3-10)
            │  │  ├─ worker (3 replicas, HPA 3-20)
            │  │  ├─ redis (1 replica)
            │  │  ├─ minio (1 replica)
            │  │  └─ ollama (1 replica)
            │  │
            │  ├─ StatefulSets
            │  │  └─ postgres (1 replica)
            │  │
            │  ├─ Services
            │  │  ├─ nextjs (ClusterIP)
            │  │  ├─ postgres (Headless + LB)
            │  │  ├─ redis (ClusterIP)
            │  │  ├─ minio (ClusterIP)
            │  │  └─ ollama (ClusterIP)
            │  │
            │  └─ Ingress
            │     └─ dharma.example.com (TLS via cert-manager)
            │
            └─ monitoring namespace
               ├─ prometheus
               └─ grafana
```

### Data Flow

```
User Browser
  ↓ (HTTPS)
Ingress (nginx) → TLS termination
  ↓
Next.js (3 pods, load-balanced)
  ├→ PostgreSQL (StatefulSet) for data
  ├→ Redis (1 pod) for job queue
  ├→ MinIO (1 pod) for file storage
  └→ Ollama (1 pod) for LLM inference
```

---

## 📊 KEY FEATURES

### ✅ High Availability (HA)
- Multi-zone deployment (3+ worker nodes)
- Pod Disruption Budgets (minAvailable: 2)
- Horizontal Pod Autoscaling (HPA)
- Load balancing via Service

### ✅ Network Security
- NetworkPolicy isolation (ingress/egress rules)
- Namespace-level RBAC
- TLS/SSL for all external traffic

### ✅ Persistent Storage
- Persistent Volumes (EBS gp3)
- Storage classes (fast-ssd for databases)
- Automatic volume expansion

### ✅ Resource Management
- Memory/CPU requests + limits
- ResourceQuota per namespace
- LimitRange for pod resources
- Auto-scaling based on metrics

### ✅ Monitoring & Observability
- Prometheus metrics collection
- Grafana dashboards
- Alert rules (error rate, latency, crashes)
- Structured logging (Loki/ELK)

### ✅ Backup & Disaster Recovery
- Daily automated backups (CronJob)
- Point-in-time recovery (PITR)
- Cross-region replication option
- Velero integration for cluster backup

### ✅ CI/CD Automation
- GitHub Actions workflow
- Automated build + test + scan + deploy
- Staging and production environments
- Smoke tests + notifications

---

## 📈 SCALING OPTIONS

### Horizontal Scaling (More Pods)
```bash
# Scale Next.js
kubectl scale deployment nextjs --replicas=10 -n dharma

# Scale workers
kubectl scale deployment worker --replicas=20 -n dharma

# Auto-scaling (already configured)
kubectl get hpa -n dharma
```

### Vertical Scaling (More Resources)
```bash
# Edit deployment resources
kubectl edit deployment nextjs -n dharma
# Update: resources.limits.cpu/memory
```

### Database Scaling
```bash
# Increase PostgreSQL storage
kubectl patch pvc postgres-data \
  -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}' \
  -n dharma
```

---

## 🔐 SECURITY BEST PRACTICES

### Secrets Management
```bash
# Use Sealed Secrets (recommended)
kubeseal < secret.yaml > secret-sealed.yaml
kubectl apply -f secret-sealed.yaml

# Never commit unencrypted secrets to git
echo "k8s/*.yaml.template" >> .gitignore
echo "k8s/*-sealed.yaml" >> .gitignore
```

### Network Isolation
```bash
# NetworkPolicy already applied
kubectl get networkpolicies -n dharma

# All traffic blocked by default
# Only explicit rules allow communication
```

### RBAC
```bash
# ServiceAccounts for each deployment
kubectl get sa -n dharma

# Pod runs as non-root user (uid: 1001)
# Read-only root filesystem where possible
```

---

## 📝 COMMON OPERATIONS

### View Logs
```bash
# View latest logs
kubectl logs -n dharma -l app=nextjs --tail=50

# Stream logs
kubectl logs -n dharma -l app=nextjs -f

# Logs from crashed pod
kubectl logs -n dharma <pod-name> --previous
```

### Port Forward
```bash
# Forward local port to service
kubectl port-forward -n dharma svc/nextjs 3000:3000

# Forward to specific pod
kubectl port-forward -n dharma nextjs-abc123 3000:3000
```

### Execute Commands
```bash
# Run command in pod
kubectl exec -n dharma <pod-name> -- ls -la

# Interactive shell
kubectl exec -n dharma <pod-name> -it -- /bin/sh
```

### Database Operations
```bash
# Port forward to database
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl port-forward -n dharma $POSTGRES_POD 5432:5432 &

# Connect with psql
psql -U dharma -h localhost dharma_db

# Run SQL query
kubectl exec -n dharma $POSTGRES_POD -- psql -U dharma -d dharma_db -c "SELECT * FROM \"User\";"
```

### Backup Database
```bash
# Create backup
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n dharma $POSTGRES_POD -- pg_dump -U dharma dharma_db > backup.sql

# Upload to S3
aws s3 cp backup.sql s3://dharma-backups/
```

---

## 🚨 TROUBLESHOOTING

### Pod not starting?
```bash
# Check pod status
kubectl describe pod <pod-name> -n dharma

# View logs
kubectl logs <pod-name> -n dharma

# Common issues:
# - ImagePullBackOff: Check registry credentials
# - CrashLoopBackOff: Check application logs
# - Pending: Check resource requests vs available
```

### High latency?
```bash
# Check resource usage
kubectl top pods -n dharma

# Check slow database queries
kubectl exec -n dharma postgres-0 -- \
  psql -U dharma -d dharma_db -c \
  "SELECT query, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"
```

### Database connection issues?
```bash
# Test PostgreSQL connectivity
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n dharma $POSTGRES_POD -- psql -U dharma -d dharma_db -c "SELECT 1;"

# Check connection string
kubectl get secret postgres-secret -n dharma -o jsonpath='{.data.connection-url}' | base64 -d
```

---

## 📚 ADDITIONAL RESOURCES

### Documentation
- [DEVOPS_ARCHITECTURE.md](DEVOPS_ARCHITECTURE.md) — Strategic DevOps design
- [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) — Detailed operational procedures

### Kubernetes References
- [Kubernetes Official Docs](https://kubernetes.io/docs/)
- [kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [Helm Chart Hub](https://artifacthub.io/)

### Monitoring & Observability
- [Prometheus Docs](https://prometheus.io/docs/)
- [Grafana Dashboards](https://grafana.com/grafana/dashboards/)
- [ELK Stack](https://www.elastic.co/what-is/elk-stack)

### Disaster Recovery
- [Velero Docs](https://velero.io/docs/)
- [PostgreSQL Backup Methods](https://www.postgresql.org/docs/15/backup.html)

---

## 🎯 NEXT STEPS

1. **Review** DEVOPS_ARCHITECTURE.md for strategic overview
2. **Follow** DEPLOYMENT_RUNBOOK.md for step-by-step deployment
3. **Test** in staging environment first
4. **Configure** GitHub Actions secrets (KUBE_CONFIG_*, SLACK_WEBHOOK_URL)
5. **Monitor** with Prometheus + Grafana
6. **Backup** database daily
7. **Test** disaster recovery procedures

---

## ✉️ SUPPORT

For issues or questions:
- Check [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) Troubleshooting section
- Review pod logs: `kubectl logs <pod> -n dharma`
- Check events: `kubectl get events -n dharma --sort-by='.lastTimestamp'`
- Contact DevOps team (Slack channel: #dharma-devops)

---

**Status:** Production-ready ✅
**Last Updated:** 2026-07-15
**Maintained By:** DevOps Team
