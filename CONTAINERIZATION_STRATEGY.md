# DHARMA — CONTAINERIZATION STRATEGY

**Part 2 of DevOps Architecture: Docker & Container Orchestration**

---

## 📋 Overview

This document outlines the containerization strategy for Dharma, covering:
1. Multi-stage Docker builds for optimal image size
2. Production-grade security hardening
3. Local development with Docker Compose
4. Container registry strategy
5. Image scanning & vulnerability management

---

## 1. DOCKER IMAGES TO BUILD

### 1.1 Next.js Application (docker/Dockerfile.app)

**Purpose:** Frontend + Backend tRPC router combined in single container

**Build Stages:**
- **Stage 1 (deps):** Install dependencies (pnpm, packages)
- **Stage 2 (builder):** Build Next.js, Prisma, TypeScript
- **Stage 3 (app):** Production runtime (minimal final image)

**Key Features:**
- ✅ Multi-stage build reduces image size (~800MB → ~200MB)
- ✅ Non-root user (nextjs:1001) for security
- ✅ Health check endpoint (/api/health)
- ✅ Node.js 22 Alpine (lightweight)
- ✅ Prisma code generation included

**Build Command:**
```bash
docker build -f docker/Dockerfile.app -t dharma:app-latest .
docker tag dharma:app-latest ghcr.io/your-org/dharma:app-latest
docker push ghcr.io/your-org/dharma:app-latest
```

**Image Size:**
- Compressed: ~50-70 MB
- Uncompressed: ~200-250 MB

### 1.2 BullMQ Worker (docker/Dockerfile.worker)

**Purpose:** Standalone async job processor

**Responsibilities:**
- Evidence processing (embedding, tagging)
- Report generation (PDF rendering)
- Connector sync (API calls)
- Policy generation (LLM calls)
- Webhook dispatch
- Regulatory monitoring

**Key Features:**
- ✅ Stateless (can scale horizontally)
- ✅ Non-root user (worker:1001)
- ✅ TX/ESM support (tsx for TypeScript)
- ✅ Same dependencies as app (code reuse)

**Build Command:**
```bash
docker build -f docker/Dockerfile.worker -t dharma:worker-latest .
docker tag dharma:worker-latest ghcr.io/your-org/dharma:worker-latest
docker push ghcr.io/your-org/dharma:worker-latest
```

**Image Size:**
- Compressed: ~50-70 MB
- Uncompressed: ~200-250 MB

### 1.3 Nginx Reverse Proxy (Optional)

**Purpose:** Static asset serving + SSL termination (if not using K8s Ingress)

**Alternative:** Use Kubernetes Ingress instead for cloud deployments

---

## 2. DOCKER COMPOSE (LOCAL DEVELOPMENT)

### 2.1 Service Stack

```
docker-compose.local.yml defines:
├─ postgres (PostgreSQL 15 + pgvector)
├─ redis (Redis 7, BullMQ backend)
├─ minio (S3-compatible storage)
├─ ollama (Local LLM inference)
├─ app (Next.js application)
└─ worker (BullMQ async processor)
```

### 2.2 Usage

**Start all services:**
```bash
# Copy template
cp .env.local.template .env.local

# Start services (background)
docker-compose -f docker-compose.local.yml up -d

# View logs
docker-compose -f docker-compose.local.yml logs -f app

# Stop services
docker-compose -f docker-compose.local.yml down
docker-compose -f docker-compose.local.yml down -v  # Remove volumes
```

### 2.3 Service Dependencies

All services include health checks:
- **postgres:** pg_isready (10s interval)
- **redis:** redis-cli ping (10s interval)
- **minio:** /minio/health/live (10s interval)
- **ollama:** /api/tags (30s interval)
- **app:** /api/health (30s interval)

App and worker wait for all dependencies to be healthy before starting.

---

## 3. SECURITY HARDENING

### 3.1 Image Security

✅ **Non-root User**
```dockerfile
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
USER nextjs
```

✅ **Minimal Base Image**
- `node:22-alpine` (~40MB)
- No unnecessary packages or shell

✅ **Read-only Filesystem (K8s)**
```yaml
securityContext:
  readOnlyRootFilesystem: true
```

✅ **No Privileged Capabilities**
```dockerfile
# All capabilities dropped by default in K8s
capabilities:
  drop:
    - ALL
```

### 3.2 Secrets Management

❌ **Do NOT:**
- Build secrets into image
- Use ENV for passwords
- Commit .env files to git

✅ **Do:**
- Use Sealed Secrets / Vault (K8s)
- Pass secrets via environment at runtime
- Rotate secrets regularly
- Audit secret access

### 3.3 Dependency Scanning

Before pushing to registry:

```bash
# Scan image for vulnerabilities
trivy image dharma:app-latest

# Or use Snyk
snyk container test dharma:app-latest

# Sign image (optional, for enterprise)
cosign sign dharma:app-latest
```

---

## 4. REGISTRY STRATEGY

### 4.1 Container Registry Options

| Registry | Use Case | Cost |
|----------|----------|------|
| **GitHub Container Registry (GHCR)** | Public/private images, integrated with GitHub | Free for public, $free for private (5GB) |
| **Amazon ECR** | AWS deployments | $0.10 per GB stored, $0.10 per GB scanned |
| **Google Artifact Registry** | GCP deployments | $0.1 per GB / month |
| **Harbor (self-hosted)** | On-premise, air-gapped | Self-hosted costs |

**Recommendation for Dharma:**
- **Dev/Staging:** GitHub Container Registry (free, integrated with GitHub Actions)
- **Production:** Amazon ECR (if AWS) or Harbor (self-hosted, enterprise)

### 4.2 Image Tagging Strategy

```bash
# Development
ghcr.io/your-org/dharma:develop-latest
ghcr.io/your-org/dharma:develop-<commit-sha>

# Staging
ghcr.io/your-org/dharma:staging-<version>
ghcr.io/your-org/dharma:staging-<commit-sha>

# Production
ghcr.io/your-org/dharma:v1.0.0
ghcr.io/your-org/dharma:v1.0.0-<commit-sha>
ghcr.io/your-org/dharma:latest  # Production current release
```

### 4.3 Image Retention Policy

```
Development (develop):     Keep last 5 images
Staging (staging):         Keep last 10 images + 30 days
Production (vX.Y.Z):       Keep all tagged releases (immutable)
```

---

## 5. CI/CD INTEGRATION

### 5.1 GitHub Actions Build Pipeline

```yaml
# .github/workflows/build.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build Docker image
        run: |
          docker build -f docker/Dockerfile.app \
            -t ghcr.io/${{ github.repository }}:${{ github.sha }} .
      
      - name: Scan image (Trivy)
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
          format: sarif
      
      - name: Push to registry
        run: |
          docker push ghcr.io/${{ github.repository }}:${{ github.sha }}
          docker tag ghcr.io/${{ github.repository }}:${{ github.sha }} \
            ghcr.io/${{ github.repository }}:latest
          docker push ghcr.io/${{ github.repository }}:latest
```

---

## 6. LOCAL TESTING CHECKLIST

### Before committing:

```bash
# 1. Validate Docker Compose config
docker-compose -f docker-compose.local.yml config

# 2. Build images
docker-compose -f docker-compose.local.yml build

# 3. Start services
docker-compose -f docker-compose.local.yml up -d

# 4. Wait for health checks
sleep 10

# 5. Verify all services healthy
docker-compose -f docker-compose.local.yml ps

# 6. Test database connection
docker exec dharma-postgres psql -U dharma -d dharma_dev -c "SELECT 1;"

# 7. Test Redis connection
docker exec dharma-redis redis-cli -a dev-password ping

# 8. Test MinIO connection
curl -s http://localhost:9000/minio/health/live | jq .

# 9. Test API health check
curl -s http://localhost:3000/api/health | jq .

# 10. View app logs
docker-compose -f docker-compose.local.yml logs app | tail -50

# 11. Cleanup
docker-compose -f docker-compose.local.yml down -v
```

---

## 7. BEST PRACTICES

### 7.1 Dockerfile Best Practices

✅ **Do:**
- Use specific base image tags (not `latest`)
- Multi-stage builds to reduce final image size
- Cache layer optimization (order instructions)
- Use `.dockerignore` to exclude unnecessary files
- Run as non-root user
- Include health check
- Minimize layers (RUN commands)

❌ **Don't:**
- Run multiple processes (one per container)
- Store secrets in Dockerfile
- Use `latest` tags in production
- Include unnecessary packages
- Run as root user
- Install development dependencies in production image

### 7.2 Docker Compose Best Practices

✅ **Do:**
- Define resource limits (memory, CPU)
- Use health checks
- Define dependencies correctly
- Use named volumes for persistence
- Use `.env` files for configuration
- Pin image versions
- Document service ports

❌ **Don't:**
- Run privileged containers
- Bind to 0.0.0.0 on all ports
- Mount entire host directories
- Store secrets in docker-compose.yml
- Use `latest` tags
- Run multiple services in one container

### 7.3 Image Optimization

**Reduce image size:**

```dockerfile
# ✅ Good: Multi-stage (reduces from ~800MB to ~200MB)
FROM node AS builder
COPY . .
RUN pnpm build

FROM node:alpine
COPY --from=builder /app/.next ./.next

# ❌ Bad: Everything in one stage
FROM node
COPY . .
RUN pnpm install && pnpm build
# Final image includes all build dependencies
```

**Layer caching:**

```dockerfile
# ✅ Good: Dependencies first (cached if package.json unchanged)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# Then copy source (invalidates cache if you change app code)
COPY . .
RUN pnpm build

# ❌ Bad: Source first (cache invalidated on every change)
COPY . .
RUN pnpm install && pnpm build
```

---

## 8. TROUBLESHOOTING

### Image Build Fails

```bash
# Check Docker daemon is running
docker ps

# View build logs with more detail
docker build --progress=plain -f docker/Dockerfile.app .

# Check disk space
docker system df

# Cleanup dangling images
docker image prune -f
```

### Container Starts but Fails

```bash
# View logs
docker logs <container-id>

# Check health
docker ps --filter "health=unhealthy"

# Inspect container
docker inspect <container-id>

# Access shell
docker exec -it <container-id> /bin/sh
```

### Networking Issues

```bash
# Check network
docker network ls
docker network inspect dharma-dev

# Test DNS resolution from container
docker exec <container> nslookup postgres

# Test connectivity
docker exec <container> curl -v http://postgres:5432
```

---

## 9. NEXT STEPS

1. **Copy templates:**
   ```bash
   cp .env.local.template .env.local
   ```

2. **Build and test locally:**
   ```bash
   docker-compose -f docker-compose.local.yml up -d
   ```

3. **Verify services:**
   ```bash
   docker-compose -f docker-compose.local.yml ps
   curl http://localhost:3000/api/health
   ```

4. **Push to registry:**
   ```bash
   docker build -f docker/Dockerfile.app -t ghcr.io/your-org/dharma:latest .
   docker push ghcr.io/your-org/dharma:latest
   ```

5. **Deploy to Kubernetes:**
   - Use image: `ghcr.io/your-org/dharma:latest`
   - See `DEPLOYMENT_RUNBOOK.md` for K8s deployment

---

## 10. FILES INCLUDED

✅ `docker/Dockerfile.app` — Next.js application image
✅ `docker/Dockerfile.worker` — BullMQ worker image
✅ `docker-compose.local.yml` — Local development stack
✅ `.env.local.template` — Environment variables template
✅ `.dockerignore` — Files to exclude from build context

---

**Status:** ✅ Ready for production build & deployment
**Last Updated:** 2026-07-15
