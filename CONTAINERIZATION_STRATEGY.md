# DHARMA — CONTAINERIZATION (as it actually is)

> This doc was rewritten to match the **real** repo. An earlier version described
> pnpm-based `docker/Dockerfile.app` / `docker-compose.local.yml` files that were
> wrong (Dharma uses npm) and have since been removed.

---

## The real container setup

Dharma already ships working, npm-based, multi-stage Dockerfiles. The root
`docker-compose.yml` builds and orchestrates them.

| Image | Dockerfile | Runs |
|---|---|---|
| Next.js app | `docker/nextjs/Dockerfile` | `npm run start` (after `next build`) |
| BullMQ worker | `docker/worker/Dockerfile` | `npx tsx src/workers/index.ts` |
| Pentest worker | `docker/pentest-worker/Dockerfile` | pentest queue consumer |
| Pentest scanner | `docker/pentest-scanner/Dockerfile` | nuclei sandbox |

Key facts (verified):
- **Package manager: npm** (`package-lock.json`, `npm ci --ignore-scripts`). There is
  no `pnpm-lock.yaml`; do **not** use pnpm in any image or CI step.
- Base image: `node:20-alpine`, multi-stage (`deps → builder → runner`).
- Prisma client is generated in-image (`npx prisma generate --schema packages/db/schema.prisma`).
- Non-root users (`nextjs:1001`, `worker:1001`).
- The app is **not** using Next.js `output: 'standalone'` — it runs `npm run start`,
  so the image keeps `node_modules` + `.next`. (If you want a smaller image later,
  add `output: 'standalone'` to `next.config.js` and switch the runner to `node server.js`.)
- App healthcheck hits `/api/health` (route exists at `src/app/api/health/route.ts`).

---

## Running the stack

The canonical stack is the repo-root `docker-compose.yml` (postgres+pgvector,
redis, minio, ollama, nextjs, worker, caddy, plus an optional monitoring profile):

```bash
# Full stack
docker compose --env-file envs/.env.docker up -d

# With monitoring (prometheus/grafana/exporters)
docker compose --env-file envs/.env.docker --profile monitoring up -d

# Tear down
docker compose --env-file envs/.env.docker down
```

Env files live under `envs/` (`.env.docker`, `.env.development`, `.env.test`, …) —
that is the repo convention, not a root `.env.local`.

---

## Building / pushing images (for k8s or Helm)

```bash
# Build the app image from the REAL Dockerfile
docker build -f docker/nextjs/Dockerfile -t ghcr.io/securitywithhem/dharma:<tag> .

# Build the worker image
docker build -f docker/worker/Dockerfile -t ghcr.io/securitywithhem/dharma-worker:<tag> .

docker push ghcr.io/securitywithhem/dharma:<tag>
docker push ghcr.io/securitywithhem/dharma-worker:<tag>
```

The `helm/dharma` chart's `app.image` / `worker.image` values point at these.

---

## Status / what's verified

- ✅ The real Dockerfiles use npm + `package-lock.json` and predate this DevOps work
  (they build the app the project already runs).
- ⚠️ **Not re-verified in this session:** I did not run `docker build` here, so image
  build success is asserted from reading the Dockerfiles, not from a build. Run the
  build commands above before depending on them.
- ✅ `helm/dharma` chart: `helm lint` + `helm template` pass (see `helm/dharma/README.md`).
