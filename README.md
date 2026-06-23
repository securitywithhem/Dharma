# Dharma

Dharma is a self-hosted, enterprise-ready compliance management platform built for Indian MSMEs and startups to comply with local regulations (such as the **DPDP Act 2023**) alongside international frameworks (**ISO 27001**, **SOC 2 Type II**). All data processing, AI operations, and storage remain strictly inside your own boundary.

## System Architecture

```
                                  ┌───────────────────────────┐
                                  │       USER BROWSER        │
                                  │  (Manrope Font, Tailwind) │
                                  └─────────────┬─────────────┘
                                                │
                                                │ HTTPS / tRPC
                                                ▼
                                  ┌───────────────────────────┐
                                  │      CADDY REVERSE PROXY  │
                                  │ (SSL Termination / Routing)│
                                  └─────────────┬─────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │    NEXT.JS APPLICATION    │
                                  │ (tRPC Gateway & SSR Pages)│
                                  └────┬────────┬────────┬────┘
                                       │        │        │
                              Prisma   │        │        │ Presigned
                              Queries  │        │        │ URLs
                                       ▼        │        ▼
 ┌──────────────────────────────────────┐        │    ┌──────────────────────────┐
 │          POSTGRES DATABASE           │        │    │       MINIO STORAGE      │
 │  (Frameworks, Policies, AuditLogs,   │◄───────┼───►│ (Evidence files, PDFs)   │
 │   pgvector Embeddings)               │        │    └──────────────────────────┘
 └──────────────────────────────────────┘        │
                                                 │ Job Queue
                                                 ▼
                                   ┌───────────────────────────┐
                                   │       REDIS QUEUE         │
                                   │    (BullMQ Job Broker)    │
                                   └─────────────┬─────────────┘
                                                 │
                                                 ▼
                                   ┌───────────────────────────┐
                                   │      BULLMQ WORKER        │
                                   │ (Background processing)   │
                                   └─────────────┬─────────────┘
                                                 │
                                                 │ Local API Calls
                                                 ▼
                                   ┌───────────────────────────┐
                                   │      OLLAMA SERVICE       │
                                   │ (Local Llama 3 & Embed)   │
                                   └──────────────────────────┘
```

## Platform Features

1. **Security & Rate Limiting**: Built-in HTTP security headers (CSP, HSTS, X-Content-Type-Options) and sliding-window rate limit checks inside standard Next.js middleware.
2. **AI-Powered Framework Mapping**: cosine-similarity mapping between uploaded evidence files and regulatory controls via local `pgvector` index.
3. **Automated RAG Policies**: RAG-based drafting of policies (Privacy Policy, Access Control, etc.) using DPDP regulation context chunks fed directly into local Llama 3.
4. **Verifiable Audit Logging**: Sequential cryptographic SHA-256 hash chaining applied to all mutating events, preventing silent database tampering.
5. **Auditor access Portal**: One-click generation of read-only temporary keys with automatically calculated expirations and banner countdowns.

## Tech Stack

- **Frontend/Backend**: Next.js 14 (App Router), tRPC v11, TypeScript 5.5, Tailwind CSS
- **Database/ORM**: PostgreSQL, `pgvector`, Prisma 5
- **Queue/Worker**: Redis 7, BullMQ 5
- **Object Store**: MinIO (S3-compatible)
- **Local AI**: Ollama (`nomic-embed-text`, `llama3`)
- **Reverse Proxy**: Caddy
- **Testing/CI**: Jest, Playwright, GitHub Actions

## Local setup


1. Copy the environment template.

```bash
cp .env.example .env.local
```

2. Install dependencies.

```bash
npm install
```

3. Start the supporting services.

```bash
docker compose up -d postgres redis minio ollama
```

4. Generate the Prisma client and apply migrations.

```bash
npm run db:generate
npm run db:deploy
```

5. Seed the baseline organization and framework records.

```bash
npm run db:seed
```

6. Start the Next.js app.

```bash
npm run dev
```

Open `http://localhost:3000`.

## Full Docker flow

The full containerized developer flow is available through Compose:

```bash
docker compose up -d --build
```

This starts:

- `postgres` on `5432`
- `redis` on `6379`
- `minio` on `9000` with console on `9001`
- `ollama` on `11434`
- `nextjs` on `3000`
- `caddy` on `80` and `443`

## Authentication notes

- Google OAuth is enabled when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- Email magic-link sign-in always exists. If SMTP variables are missing, the verification URL is logged to the server console for development.
- New users are provisioned into a newly created organization automatically, with the first session receiving the `ADMIN` role for that workspace.
- `/dashboard/*` routes are protected by `middleware.ts` and revalidated server-side in the dashboard layout.

## Useful scripts

```bash
npm run dev
npm run build
npm run type-check
npm run test
npm run test:e2e
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
npm run docker:up
npm run docker:down
```

## Database notes

- Prisma schema lives at `packages/db/schema.prisma`.
- The initial SQL migration is stored in `packages/db/migrations/20260621000100_init/migration.sql`.
- Vector indexes for `Evidence.embedding` and `RegulationSnippet.embedding` are created manually in the migration using HNSW.
- The seed script creates a default organization and baseline framework rows. Set `SEED_ADMIN_EMAIL` to attach an explicit admin account.

## Testing & E2E Validation

The platform includes two testing suites:

### 1. Unit & Integration (Jest)
Runs unit validations for server-side logic:
```bash
npm run test
```
Covered areas:
- NextAuth JWT session transformations
- RBAC helpers
- tRPC procedure scoping and organization contexts
- Tamper detection on the cryptographic audit chain

### 2. End-to-End Validation (Playwright)
Executes simulated user workflows on a headless/headed browser:
```bash
npm run test:e2e
```
Available spec suites:
- `auth.spec.ts`: Magic Link inputs, landing page entry, redirection to sign-in.
- `evidence.spec.ts`: Uploading file to MinIO, mapping control requirements, matching suggestions, and audit trail verification.
- `policy.spec.ts`: Stepper-based policy wizard inputs, local Ollama generation waiting states, TipTap editor controls, and publishing.
- `auditor.spec.ts`: Auditor link generation via Settings, auditor token cookie generation, read-only dashboard layout, and remaining countdown timer banner.

### 3. CI Pipeline (GitHub Actions)
A workflow `.github/workflows/e2e.yml` is executed on every push and pull request to the `main` branch. The runner automatically spins up the Docker Compose services, waits for health states, runs DB migrations/seeds, and executes Playwright tests, archiving reports on failure.


## Known operational requirements

- Docker must be installed locally for the full stack.
- OAuth requires external credentials from Google Cloud.
- SMTP is optional for development but required for actual email delivery.
- Ollama starts empty; pull models separately after the container is healthy.

## Suggested first commands

```bash
cp .env.example .env.local
npm install
docker compose up -d postgres redis minio ollama
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

---

## Backup & Restore

### Automated Backups

The `backup-scheduler` service (Ofelia cron) runs automatically with Docker Compose and triggers nightly backups:

| Schedule | Job | Output |
|---|---|---|
| `0 2 * * *` (02:00 UTC) | PostgreSQL pg_dump | `/backups/pg/dharma_YYYYMMDD_HHMMSS.sql.gz` |
| `30 2 * * *` (02:30 UTC) | MinIO mirror | `/backups/minio/dharma-evidence_YYYYMMDD_HHMMSS/` |

Configure the host backup path via:
```bash
# In .env.docker
BACKUP_HOST_PATH=/your/host/backup/dir   # default: /tmp/dharma-backups
BACKUP_RETENTION_DAYS=7                  # how many days to keep
```

### Manual Backup

```bash
# PostgreSQL
docker exec dharma-postgres bash -c \
  "BACKUP_DIR=/backups/pg /scripts/backup-pg.sh"

# MinIO
docker exec dharma-backup-scheduler bash -c \
  "/scripts/backup-minio.sh"

# Both at once (master orchestrator)
docker exec dharma-backup-scheduler bash -c \
  "/scripts/backup-all.sh"
```

### Restore PostgreSQL

> ⚠️ **Warning:** Restoring drops and recreates the database. All current data is lost.

```bash
# Restore from latest backup (auto-detected)
docker exec -it dharma-postgres bash -c \
  "FORCE_RESTORE=true /scripts/restore-pg.sh"

# Restore from a specific file
docker exec -it dharma-postgres bash -c \
  "/scripts/restore-pg.sh /backups/pg/dharma_20240101_120000.sql.gz"
```

After restore, apply any pending migrations:
```bash
npm run db:deploy
```

### Restore MinIO

```bash
# Restore from latest snapshot (via symlink)
docker exec -it dharma-backup-scheduler bash -c \
  "FORCE_RESTORE=true /scripts/restore-minio.sh"

# Restore from a specific snapshot directory
docker exec -it dharma-backup-scheduler bash -c \
  "/scripts/restore-minio.sh /backups/minio/dharma-evidence_20240101_120000"
```

---

## Monitoring

### Start the monitoring stack

Monitoring services use Docker Compose profiles to keep them opt-in (they don't start with the default `up`):

```bash
# Start core stack + monitoring
docker compose --env-file .env.docker --profile monitoring up -d

# Start monitoring only (core already running)
docker compose --env-file .env.docker --profile monitoring up -d \
  prometheus grafana postgres-exporter redis-exporter
```

### Access URLs

| Service | URL | Credentials |
|---|---|---|
| **Grafana** | http://localhost:3001 | `admin` / `dharma-grafana` |
| **Prometheus** | http://localhost:9090 | — |
| **PostgreSQL Exporter** | http://localhost:9187/metrics | — |
| **Redis Exporter** | http://localhost:9121/metrics | — |

### Health & Status Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Lightweight liveness probe (DB check only) |
| `GET /api/status` | Full status: DB, Redis, MinIO, Ollama + latency |
| `GET /api/trpc/health.checkAll` | tRPC health check (all services) |
| `GET /api/trpc/health.ping` | Ultra-fast liveness ping |

```bash
# Quick health check
curl http://localhost:3000/api/health

# Full service status
curl http://localhost:3000/api/status | jq .

# tRPC health
curl http://localhost:3000/api/trpc/health.checkAll | jq .
```

### Viewing logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f nextjs
docker compose logs -f postgres
docker compose logs -f backup-scheduler

# Last N lines
docker compose logs --tail=100 worker
```

---

## Docker Scripts Reference

```bash
npm run docker:up       # Start all services (detached)
npm run docker:down     # Stop all services
npm run docker:logs     # Follow Next.js logs
npm run docker:reset    # Full reset (down -v + rebuild)
```

