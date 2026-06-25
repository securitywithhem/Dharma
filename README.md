# Dharma – Self-Hosted Compliance Platform

Dharma is a self-hosted, enterprise-ready compliance management platform built for Indian MSMEs and startups to comply with local regulations (such as the **DPDP Act 2023**) alongside international frameworks (**ISO 27001**, **SOC 2 Type II**). All data processing, AI operations, and storage remain strictly inside your own boundary.

---

## 🎯 Problems Solved & Efficiency Benefits

### 1. Strict Data Sovereignty
*   **The Problem:** Traditional SaaS compliance tools (e.g., Vanta, Drata) require you to upload highly sensitive organizational data—such as cloud configurations, employee details, policy drafts, and internal network logs—to external third-party cloud servers. This violates internal privacy protocols and data-residency laws like India's **DPDP Act 2023**.
*   **Dharma's Solution:** By executing 100% of its data operations inside your own network boundary (using a local `pgvector` database, a local `MinIO` S3 storage server, and local `Ollama` models), Dharma guarantees that zero sensitive compliance data ever leaves your company's network.

### 2. Manual & Complex Framework Mapping
*   **The Problem:** Manually parsing compliance standards (which have hundreds of controls) and mapping them to relevant evidence files (e.g., firewall logs, screenshots, password policies) takes compliance teams weeks of manual effort.
*   **Dharma's Solution:** Dharma extracts text from uploaded evidence and uses local embeddings (`nomic-embed-text`) via `pgvector` to automatically perform semantic cosine similarity searches. It instantly recommends the top 3 controls a piece of evidence satisfies, reducing mapping times from hours to single-click actions.

### 3. Prohibitive Compliance Costs
*   **The Problem:** Commercial compliance platforms charge between $10,000 to $50,000+ annually in subscription fees. This creates a massive financial barrier for startups and MSMEs needing SOC 2 or ISO 27001 to close enterprise clients.
*   **Dharma's Solution:** Dharma is entirely open-source and runs on self-hosted infrastructure. By utilizing local LLMs via Ollama, it eliminates external API token billing (e.g., OpenAI/Anthropic APIs), resulting in zero marginal cost per compliance operation.

### 4. Drafting Regulatory-Compliant Policies
*   **The Problem:** Drafting core security and privacy policies (e.g., DPDP Consent Notice, Access Control Policy) requires specialized legal and compliance knowledge. Engaging external consultants is expensive and slow.
*   **Dharma's Solution:** Dharma leverages a local **RAG (Retrieval-Augmented Generation)** pipeline. It retrieves the exact sections of regulations (e.g., clauses from the DPDP Act 2023) and feeds them alongside your company profile into local LLMs (e.g., Llama 3 8B) to instantly draft context-specific, professional policies.

### 5. Vulnerable Compliance Records & Logs
*   **The Problem:** Standard database-logged audit trails can be altered by system administrators, making it difficult to verify that compliance records have not been retrospectively modified or deleted during audits.
*   **Dharma's Solution:** Dharma implements **Cryptographic Hash Chaining** (similar to a blockchain ledger). Every mutating audit event is hashed using SHA-256 and linked sequentially to the hash of the preceding record. If any past row is altered, the chain breaks immediately, flagging the tampering.

### 6. Secure and Dynamic Auditor Access
*   **The Problem:** Sharing compliance evidence with external auditors typically involves sending zip files over email or creating permanent, hard-to-revoke user accounts in internal tools.
*   **Dharma's Solution:** Dharma provides a temporary, read-only portal for external compliance auditors. It generates expiring access tokens with customized durations (e.g., 24 hours), showing count-down banners and revoking access automatically upon expiration.

---

## 🚀 How Is It Efficient?
*   **Zero Cloud Costs:** Uses Ollama local models (`nomic-embed-text` and `llama3`) and self-hosted database/storage.
*   **Background Processing Async Architecture:** Heavy lifting (generating embeddings, compiling PDFs, querying Ollama models) is offloaded to a Redis-backed BullMQ background worker queue, preventing UI/API request thread blocks.
*   **Strict Type-Safety:** Built on a single monorepo using Next.js, Prisma, and tRPC v11, ensuring compile-time safety and automatic sync between the DB model and client UI.

---

## 🏗️ System Architecture

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

---

## 🛠️ Step-by-Step Clone & Run Guide

Follow these steps to download the repository, set up local configuration, and run the entire suite of services.

### 📋 Prerequisites
Make sure you have the following installed on your machine:
*   [Git](https://git-scm.com/)
*   [Docker & Docker Compose](https://www.docker.com/) (Ensure the Docker daemon is running)
*   [Node.js](https://nodejs.org/) (Version >= 18.18.0, only required if running outside Docker)

### 1. Clone the Repository
Clone the codebase to your local directory and navigate into it:
```bash
git clone https://github.com/your-username/dharma-compliance.git
cd dharma-compliance
```

### 2. Configure Environment Variables
Dharma reads configurations from environment files. We provide pre-configured files for both host and Docker runs:
```bash
# Setup Docker environment config
cp .env.example .env.docker

# Setup local environment config (if running Next.js directly on host)
cp .env.example .env
```

### 3. Spin Up the Services (Docker Flow)
The fastest way to run Dharma is to run all services containerized. This includes PostgreSQL, Redis, MinIO, Ollama, Next.js, and Caddy:
```bash
docker compose up -d --build
```
This command starts:
*   **PostgreSQL (`pgvector`)** on port `5432`
*   **Redis** on port `6379`
*   **MinIO Console** on port `9001` (API on port `9000`)
*   **Ollama AI engine** on port `11434`
*   **Next.js App** on port `3000`
*   **Caddy Proxy** on ports `80` and `443`

### 4. Initialize and Seed the Database
Apply migrations, generate the Prisma schema, and seed the default organization along with compliance frameworks (DPDP, ISO 27001, SOC 2):
```bash
docker exec dharma-nextjs npm run seed:all
```
*This command runs database schemas, sets up the cryptographic log chain, and inserts 144 compliance controls across the frameworks.*

### 5. Access the Web App & Sign In
Open your web browser (Chrome) and navigate to the application:
*   **Application Link:** [http://localhost:3000](http://localhost:3000) (or via reverse proxy: [http://localhost:80](http://localhost:80))
*   **MinIO Console:** [http://localhost:9001](http://localhost:9001) (User: `minioadmin` | Password: `minioadmin_change_me`)

#### 🔑 Magic-Link Signing In Walkthrough:
Dharma uses secure passwordless email sign-ins. In local development environments:
1. Enter your email (e.g. `admin@dharma.local`) on the sign-in screen and click **Sign In**.
2. Run the following command in your terminal to view the server console logs:
   ```bash
   docker compose logs -f nextjs
   ```
3. Look for the logged NextAuth magic link (e.g., `http://localhost:3000/api/auth/callback/email?...`).
4. Copy the link, paste it into Chrome, and you will be logged in with the `ADMIN` role.

---

## 🛠️ Local Development (Alternative Host-Based Flow)

If you plan to modify Next.js code and need hot reloading, run Next.js on your host machine while keeping databases in Docker:

1. Start only the supporting databases and AI engines:
   ```bash
   docker compose up -d postgres redis minio ollama
   ```
2. Install npm packages:
   ```bash
   npm install
   ```
3. Build database clients and seed records:
   ```bash
   npm run db:generate
   npm run db:deploy
   npm run db:seed
   npm run seed:frameworks
   ```
4. Start Next.js on your host:
   ```bash
   npm run dev
   ```
5. View the app at [http://localhost:3000](http://localhost:3000).

---

## 🗄️ Backup & Restore

### Automated Backups
The `backup-scheduler` container (powered by Ofelia cron) automatically manages backups:
*   **PostgreSQL:** Every night at `02:00 UTC` (`/backups/pg/dharma_YYYYMMDD_HHMMSS.sql.gz`)
*   **MinIO Objects:** Every night at `02:30 UTC` (`/backups/minio/dharma-evidence_YYYYMMDD_HHMMSS/`)

### Manual Backups
Trigger immediate snapshots:
```bash
# Backup databases and files simultaneously
docker exec dharma-backup-scheduler /scripts/backup-all.sh
```

### Restoring Snapshots
To restore from the latest automated backup:
```bash
# Restore Database (Warning: Overwrites existing tables)
docker exec -it dharma-postgres /scripts/restore-pg.sh

# Restore MinIO Objects
docker exec -it dharma-backup-scheduler /scripts/restore-minio.sh
```

---

## 📊 Monitoring & Observability

Dharma includes a pre-packaged monitoring profile featuring Prometheus, Grafana, and resource exporters.

### Start the Monitoring Stack
```bash
docker compose --profile monitoring up -d
```

### Access Ports & Metrics
*   **Grafana Dashboard:** [http://localhost:3001](http://localhost:3001) (User: `admin` | Password: `dharma-grafana`)
*   **Prometheus Console:** [http://localhost:9090](http://localhost:9090)
*   **Liveness Probe:** `curl http://localhost:3000/api/health`
*   **Full Service Health (latency checks):** `curl http://localhost:3000/api/status`
