# DHARMA — DEPLOYMENT RUNBOOK

**Operational guide for deploying, scaling, monitoring, and troubleshooting Dharma on Kubernetes**

> ⚠️ **Untested procedures.** None of the commands below have been run against a
> live Dharma cluster. They are a starting-point runbook derived from the
> template manifests, not a verified operational playbook. Validate in staging
> and correct as you go.

---

## TABLE OF CONTENTS

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Initial Cluster Setup](#initial-cluster-setup)
3. [Deploying to Staging](#deploying-to-staging)
4. [Deploying to Production](#deploying-to-production)
5. [Monitoring & Alerting](#monitoring--alerting)
6. [Scaling Operations](#scaling-operations)
7. [Backup & Disaster Recovery](#backup--disaster-recovery)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Incident Response](#incident-response)
10. [Runbook Index](#runbook-index)

---

## PRE-DEPLOYMENT CHECKLIST

### Infrastructure Requirements
- [ ] Kubernetes cluster 1.27+ (EKS, GKE, or self-hosted)
- [ ] 3+ worker nodes (6+ vCPU, 12+ GB RAM each)
- [ ] Multi-zone setup for HA
- [ ] Persistent storage class configured (fast-ssd)
- [ ] Ingress controller (nginx-ingress)
- [ ] cert-manager for TLS

### Prerequisites
- [ ] kubectl configured and authenticated
- [ ] Docker registry (ECR, Harbor, or GCR) set up
- [ ] Sealed Secrets or Vault initialized
- [ ] GitHub Actions secrets configured
- [ ] Slack webhook for notifications
- [ ] Monitoring stack (Prometheus, Grafana, Loki)

### Application Readiness
- [ ] All tests passing (lint, unit, integration)
- [ ] Docker image built and scanned (Trivy)
- [ ] Dockerfile optimized (multi-stage)
- [ ] Environment variables documented
- [ ] Database migrations tested locally

---

## INITIAL CLUSTER SETUP

### 1. Create Kubernetes Cluster (AWS EKS Example)

```bash
# Create EKS cluster
eksctl create cluster \
  --name dharma-prod \
  --region us-east-1 \
  --version 1.29 \
  --nodegroup-name default \
  --node-type t3.xlarge \
  --nodes 6 \
  --nodes-min 3 \
  --nodes-max 10

# Get kubeconfig
aws eks update-kubeconfig --region us-east-1 --name dharma-prod

# Verify cluster
kubectl get nodes
```

### 2. Install Essential Add-ons

```bash
# Install ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --values ingress-values.yaml

# Install cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Install metrics-server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Install Sealed Secrets
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.18.0/controller.yaml -n kube-system
```

### 3. Create Storage Classes

```bash
# Fast SSD storage class
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
  encrypted: "true"
allowVolumeExpansion: true
reclaimPolicy: Retain
EOF

# Standard storage class (for backups)
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
provisioner: ebs.csi.aws.com
parameters:
  type: gp2
allowVolumeExpansion: true
reclaimPolicy: Delete
EOF
```

### 4. Create Namespace & Network Policies

```bash
# Deploy namespace and network policies
kubectl apply -f k8s/namespace.yaml

# Verify
kubectl get namespace dharma
kubectl get networkpolicies -n dharma
```

---

## DEPLOYING TO STAGING

### 1. Prepare Secrets

```bash
# Generate strong passwords
POSTGRES_PASSWORD=$(openssl rand -base64 32)
REDIS_PASSWORD=$(openssl rand -base64 32)
MINIO_PASSWORD=$(openssl rand -base64 32)

# Create secrets
kubectl create secret generic postgres-secret \
  --from-literal=username=dharma \
  --from-literal=password=$POSTGRES_PASSWORD \
  --from-literal=database=dharma_db \
  --from-literal=connection-url="postgresql://dharma:$POSTGRES_PASSWORD@postgres.dharma.svc.cluster.local:5432/dharma_db" \
  -n dharma \
  --dry-run=client -o yaml | kubeseal -f - > k8s/postgres-sealed.yaml

# Apply sealed secret
kubectl apply -f k8s/postgres-sealed.yaml

# Repeat for redis-secret, minio-secret, nextjs-secret
```

### 2. Deploy Core Services (Database, Cache, Storage)

```bash
# PostgreSQL
kubectl apply -f k8s/postgres.yaml

# Wait for PostgreSQL to be ready
kubectl rollout status statefulset/postgres -n dharma --timeout=5m

# Redis
kubectl apply -f k8s/redis.yaml

# Wait for Redis
kubectl rollout status deployment/redis -n dharma --timeout=3m

# MinIO
kubectl apply -f k8s/minio-ollama-worker.yaml

# Verify all services are running
kubectl get pods -n dharma
```

### 3. Initialize Database

```bash
# Get PostgreSQL pod name
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')

# Port forward
kubectl port-forward -n dharma $POSTGRES_POD 5432:5432 &

# Run migrations
npm run db:deploy

# Kill port forward
pkill -f "kubectl port-forward"
```

### 4. Deploy Application

```bash
# Update image reference in k8s/nextjs.yaml
sed -i 's|REGISTRY/dharma:latest|ghcr.io/your-org/dharma:latest|g' k8s/nextjs.yaml

# Deploy Next.js application
kubectl apply -f k8s/nextjs.yaml

# Deploy Ollama
kubectl apply -f k8s/minio-ollama-worker.yaml

# Deploy BullMQ workers
kubectl apply -f k8s/minio-ollama-worker.yaml

# Wait for rollout
kubectl rollout status deployment/nextjs -n dharma --timeout=5m

# Verify
kubectl get pods -n dharma
kubectl get svc -n dharma
```

### 5. Configure Ingress & TLS

```bash
# Update email and domain in k8s/ingress.yaml
sed -i 's|admin@example.com|your-email@example.com|g' k8s/ingress.yaml
sed -i 's|dharma.example.com|dharma-staging.example.com|g' k8s/ingress.yaml

# Deploy ingress
kubectl apply -f k8s/ingress.yaml

# Wait for certificate
kubectl get certificate -n dharma -w

# Verify TLS certificate
kubectl describe certificate dharma-tls -n dharma
```

### 6. Validate Deployment

```bash
# Health checks
kubectl get pods -n dharma --no-headers | awk '{print $3}' | sort | uniq -c

# Port forward to verify services
kubectl port-forward -n dharma svc/nextjs 3000:3000 &
curl http://localhost:3000/api/health
pkill -f "kubectl port-forward"

# Check logs
kubectl logs -n dharma -l app=nextjs --tail=50

# Verify database connection
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n dharma $POSTGRES_POD -- psql -U dharma -d dharma_db -c "SELECT version();"
```

---

## DEPLOYING TO PRODUCTION

### Pre-Production Checks

```bash
# 1. Verify staging is healthy
kubectl get pods -n dharma --context=staging

# 2. Backup production database
BACKUP_FILE="dharma-prod-$(date +%Y%m%d-%H%M%S).sql"
kubectl exec -n dharma postgres-0 --context=prod -- \
  pg_dump -U dharma dharma_db > $BACKUP_FILE
echo "Backup saved to: $BACKUP_FILE"

# 3. Verify backup integrity
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
psql -U dharma -h localhost -f $BACKUP_FILE -d dharma_test

# 4. Run smoke tests
curl -f https://dharma.example.com/api/health || exit 1
```

### Production Deployment

```bash
# 1. Create production namespace
kubectl apply -f k8s/namespace.yaml --context=prod

# 2. Deploy secrets (using Sealed Secrets)
kubectl apply -f k8s/postgres-sealed.yaml --context=prod
kubectl apply -f k8s/redis-sealed.yaml --context=prod
kubectl apply -f k8s/minio-sealed.yaml --context=prod
kubectl apply -f k8s/nextjs-sealed.yaml --context=prod

# 3. Deploy services
kubectl apply -f k8s/postgres.yaml --context=prod
kubectl rollout status statefulset/postgres -n dharma --timeout=5m --context=prod

kubectl apply -f k8s/redis.yaml --context=prod
kubectl rollout status deployment/redis -n dharma --timeout=3m --context=prod

kubectl apply -f k8s/minio-ollama-worker.yaml --context=prod

# 4. Run migrations (production database)
# Use blue-green or canary deployment strategy
kubectl set env deployment/nextjs \
  MIGRATION_RUN=true \
  -n dharma \
  --context=prod

kubectl rollout status deployment/nextjs -n dharma --timeout=10m --context=prod

# 5. Deploy application
kubectl apply -f k8s/nextjs.yaml --context=prod
kubectl apply -f k8s/ingress.yaml --context=prod

# 6. Verify deployment
kubectl get pods -n dharma --context=prod
kubectl rollout status deployment/nextjs -n dharma --timeout=5m --context=prod
```

### Post-Deployment Validation

```bash
# 1. Check pod status
kubectl get pods -n dharma --context=prod
for pod in $(kubectl get pods -n dharma -l app=nextjs -o jsonpath='{.items[*].metadata.name}' --context=prod); do
  echo "Checking $pod..."
  kubectl logs -n dharma $pod --context=prod | tail -5
done

# 2. Verify database connectivity
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}' --context=prod)
kubectl exec -n dharma $POSTGRES_POD --context=prod -- \
  psql -U dharma -d dharma_db -c "SELECT COUNT(*) FROM \"User\";"

# 3. Test API endpoints
curl -f https://dharma.example.com/api/health
curl -f https://dharma.example.com/api/trpc/framework.list

# 4. Monitor logs for errors
kubectl logs -n dharma -l app=nextjs --tail=100 --context=prod | grep -i error

# 5. Check resource usage
kubectl top nodes --context=prod
kubectl top pods -n dharma --context=prod
```

---

## MONITORING & ALERTING

### 1. Deploy Prometheus & Grafana

```bash
# Add Prometheus Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --values monitoring-values.yaml
```

### 2. Create Alerts

```yaml
# Prometheus alert rules (prometheus-rules.yaml)
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: dharma-alerts
  namespace: monitoring
spec:
  groups:
    - name: dharma
      interval: 30s
      rules:
        - alert: DharmaHighErrorRate
          expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
          for: 5m
          annotations:
            summary: "High error rate detected"

        - alert: DharmaHighLatency
          expr: histogram_quantile(0.99, http_request_duration_seconds) > 1
          for: 5m
          annotations:
            summary: "High latency detected"

        - alert: DharmaPodCrashLooping
          expr: rate(kube_pod_container_status_restarts_total[1h]) > 3
          for: 5m
          annotations:
            summary: "Pod is crash looping"

        - alert: DharmaPostgresDown
          expr: up{job="postgres"} == 0
          for: 1m
          annotations:
            summary: "PostgreSQL is down"
```

### 3. Create Grafana Dashboards

```bash
# Import dashboards
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80 &
# Open http://localhost:3000
# Import dashboard: https://grafana.com/grafana/dashboards/6417
```

---

## SCALING OPERATIONS

### Horizontal Scaling (More Pods)

```bash
# Scale Next.js application
kubectl scale deployment nextjs --replicas=10 -n dharma

# Scale BullMQ workers
kubectl scale deployment worker --replicas=20 -n dharma

# Verify
kubectl get pods -n dharma -l app=nextjs | wc -l
```

### Vertical Scaling (More Resources)

```bash
# Edit deployment resources
kubectl edit deployment nextjs -n dharma

# Change:
# resources:
#   requests:
#     cpu: "1"
#     memory: "1Gi"
#   limits:
#     cpu: "2"
#     memory: "2Gi"
```

### Auto-Scaling Configuration

```bash
# HPA is already defined in nextjs.yaml
# Monitor auto-scaling
kubectl get hpa -n dharma -w

# View HPA metrics
kubectl describe hpa nextjs -n dharma
```

---

## BACKUP & DISASTER RECOVERY

### Automated Backup Strategy

```bash
# Daily backup job
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: dharma
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM UTC
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:15-alpine
            command:
            - /bin/sh
            - -c
            - |
              pg_dump -U dharma -h postgres -d dharma_db | \
              aws s3 cp - s3://dharma-backups/postgres-\$(date +%Y%m%d-%H%M%S).sql.gz
            env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: password
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: access-key
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: secret-key
          restartPolicy: OnFailure
EOF
```

### Restore from Backup

```bash
# Download backup from S3
aws s3 cp s3://dharma-backups/postgres-20260715-020000.sql.gz .
gunzip postgres-20260715-020000.sql.gz

# Port forward to PostgreSQL
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl port-forward -n dharma $POSTGRES_POD 5432:5432 &

# Restore
psql -U dharma -h localhost dharma_db < postgres-20260715-020000.sql

# Verify
psql -U dharma -h localhost dharma_db -c "SELECT COUNT(*) FROM \"User\";"

# Kill port forward
pkill -f "kubectl port-forward"
```

---

## TROUBLESHOOTING GUIDE

### Pod Not Starting

```bash
# 1. Check pod status
kubectl describe pod <pod-name> -n dharma

# 2. Check logs
kubectl logs <pod-name> -n dharma
kubectl logs <pod-name> -n dharma --previous  # Previous crash

# 3. Common issues:
# - ImagePullBackOff: Check image exists in registry
# - CrashLoopBackOff: Check application logs
# - Pending: Check resource requests vs available resources
```

### Database Connection Issues

```bash
# 1. Verify PostgreSQL is running
kubectl get pods -n dharma -l app=postgres

# 2. Check PostgreSQL logs
kubectl logs -n dharma postgres-0

# 3. Verify credentials
kubectl get secret postgres-secret -n dharma -o yaml | grep connection-url | base64 -d

# 4. Test connection
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n dharma $POSTGRES_POD -- psql -U dharma -d dharma_db -c "SELECT 1;"
```

### High Memory Usage

```bash
# Check memory usage per pod
kubectl top pods -n dharma

# Increase memory limits
kubectl set resources deployment nextjs -n dharma \
  --limits=memory=2Gi

# Check for memory leaks
kubectl logs -n dharma -l app=nextjs | grep -i memory
```

### API Latency Issues

```bash
# Check request latency
kubectl exec -n dharma <nextjs-pod> -- \
  curl -w "@curl-format.txt" https://localhost:3000/api/health

# Check PostgreSQL slow queries
POSTGRES_POD=$(kubectl get pods -n dharma -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n dharma $POSTGRES_POD -- \
  psql -U dharma -d dharma_db -c "SELECT query, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"
```

---

## INCIDENT RESPONSE

### Database Corruption

```bash
# 1. Verify backup integrity
psql -U dharma -h backup-server dharma_test < latest-backup.sql

# 2. Restore from backup
# See "Restore from Backup" section above

# 3. Verify data
kubectl exec -n dharma postgres-0 -- \
  psql -U dharma -d dharma_db -c "VACUUM ANALYZE;"

# 4. Monitor for issues
kubectl logs -n dharma -l app=nextjs --tail=100
```

### Service Outage

```bash
# 1. Check cluster health
kubectl get nodes
kubectl get pods -n dharma

# 2. Restart pods (in order)
kubectl rollout restart deployment/nextjs -n dharma
kubectl rollout restart deployment/worker -n dharma

# 3. Verify services
for svc in nextjs postgres redis minio; do
  echo "Checking $svc..."
  kubectl get svc $svc -n dharma
done

# 4. Check network connectivity
kubectl exec -n dharma <nextjs-pod> -- nslookup postgres.dharma.svc.cluster.local
```

### DDoS Attack

```bash
# 1. Enable rate limiting (already in ingress annotations)
# 2. Monitor traffic
kubectl logs -n ingress-nginx <ingress-pod> | tail -100

# 3. Temporarily block IP ranges
kubectl patch ingress dharma -n dharma --type merge -p \
  '{"spec":{"rules":[{"http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"nextjs","port":{"number":3000}}}}],"annotations":{"nginx.ingress.kubernetes.io/limit-rps":"100"}}]}}' 

# 4. Increase replica count
kubectl scale deployment nextjs --replicas=20 -n dharma
```

---

## RUNBOOK INDEX

| Procedure | Command |
|-----------|---------|
| **Cluster Info** | `kubectl cluster-info` |
| **Node Status** | `kubectl get nodes -o wide` |
| **Pod Logs** | `kubectl logs <pod> -n dharma` |
| **Port Forward** | `kubectl port-forward svc/nextjs 3000:3000 -n dharma` |
| **Execute Command** | `kubectl exec <pod> -n dharma -- <command>` |
| **Restart Deployment** | `kubectl rollout restart deployment/nextjs -n dharma` |
| **Scale Replicas** | `kubectl scale deployment nextjs --replicas=5 -n dharma` |
| **Get Events** | `kubectl get events -n dharma --sort-by='.lastTimestamp'` |
| **Describe Pod** | `kubectl describe pod <pod> -n dharma` |
| **Delete Pod** | `kubectl delete pod <pod> -n dharma` |
| **Check Resource Usage** | `kubectl top pods -n dharma` |
| **Backup Database** | `kubectl exec postgres-0 -n dharma -- pg_dump -U dharma dharma_db > backup.sql` |
| **Restore Database** | `kubectl exec -i postgres-0 -n dharma -- psql -U dharma dharma_db < backup.sql` |

---

**For additional help, check:**
- Kubernetes docs: https://kubernetes.io/docs/
- Dharma docs: See DEVOPS_ARCHITECTURE.md
- On-call runbook: See incident-response.md
