# Dharma

Dharma is a self-hosted compliance management platform for Indian MSMEs and startups. This repository now contains the complete Phase 0.1 foundation layer: Docker orchestration, a Next.js 14 App Router application, tRPC v11, Prisma 5, NextAuth.js, protected dashboard routes, and baseline test coverage.

## What is included

- `docker-compose.yml` for PostgreSQL with pgvector, Redis, MinIO, Ollama, Next.js, and Caddy.
- `packages/db/schema.prisma` with 13 models, pgvector fields, RBAC enums, and manual migration SQL.
- `src/server` for Prisma, NextAuth, tRPC context, routers, and audit-hash utilities.
- `src/app` for the App Router layout, protected dashboard pages, auth screens, health route, and tRPC route handler.
- `tests/` for auth, tRPC, and database-focused unit coverage plus a small Playwright smoke suite.

## Stack

- Next.js 14
- TypeScript strict mode
- tRPC v11
- Prisma 5 with PostgreSQL and pgvector
- NextAuth.js v4
- Tailwind CSS with shadcn-style primitives
- Jest and Playwright
- Docker Compose + Caddy

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

## Testing

Unit and integration coverage currently includes:

- NextAuth JWT and session claim enrichment
- RBAC helpers
- tRPC auth and organization scoping
- Audit hash determinism and tamper detection
- Seed script behavior

Playwright smoke coverage currently checks:

- Landing page rendering
- Redirect of unauthenticated users from `/dashboard` to `/auth/signin`

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
