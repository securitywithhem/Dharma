# 2. TRD — Technical Requirements Document

## Dharma — Technical Architecture

---

## 1. Technology Stack Overview

Dharma is architected as a fully containerized, self-hosted application. To maintain strict data privacy, all services (including the database, cache, file storage, and AI inference engines) run locally within the host environment.

### Core Stack
| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Frontend Framework** | Next.js (App Router) | 14.x | React framework supporting server-side rendering (SSR) and client components. |
| **Backend API Gateway**| tRPC | v11 | Type-safe RPC framework bridging frontend and backend with zero API boilerplate. |
| **Language** | TypeScript | 5.x | Enforces compile-time type safety across the entire monorepo. |
| **Styling** | Tailwind CSS + shadcn/ui | 3.4+ | Utility-first styling combined with radix-ui primitives for visual consistency. |
| **State Management** | Zustand | 4.4+ | Client-side store for UI state, auth sessions, and user context. |
| **Database** | PostgreSQL + pgvector | 15+ | Relational database utilizing `pgvector` for similarity searches. |
| **ORM** | Prisma | 5.x | Modern database client supporting migrations and relation queries. |
| **Job Queue** | Redis + BullMQ | 7.x / 5.x | Asynchronous background worker system for long-running CPU tasks. |
| **Object Storage** | MinIO | Latest | S3-compatible, self-hosted file store for evidence screenshots and documents. |
| **Authentication** | NextAuth.js | 4.24+ | Secure credentials, email magic links, and Google OAuth integrations. |
| **Local AI Engine** | Ollama (Llama 3 8B / Mistral) | Latest | Runs local language and embedding models with zero external network dependencies. |
| **AI Orchestration** | LangChain.js | Latest | Utility wrapper for retrieval-augmented generation (RAG) and model queries. |

---

## 2. System Architecture

Dharma utilizes a microservices-in-a-box architecture, run via a single Docker Compose execution:

```
                                  ┌───────────────────────────┐
                                  │       USER BROWSER        │
                                  │   (Tailwind, Zustand)     │
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
                                  └───────────────────────────┘
```

### Flow Descriptions
1. **tRPC Gateways:** Next.js uses client-side hooks mapped to backend controllers via `tRPC v11`. Types are shared directly from Prisma to the frontend components.
2. **Object Storage Interaction:** Instead of uploading files directly to Next.js API routes (which can crash due to body size limits or block main thread execution), the frontend requests a **presigned upload URL** from the backend via tRPC, then uploads the file directly to the self-hosted **MinIO** container.
3. **Background Worker Engine:** Heavy computation tasks (generating SHA-256 cryptographic logs, parsing text via OCR, calling Ollama to generate embeddings or draft policies) are pushed onto **BullMQ** queues hosted inside **Redis**, ensuring API routes remain responsive (<100ms response times).

---

## 3. Database & pgvector Integration

### pgvector Embedding Architecture
For mapping uploaded evidence to compliance requirements, Dharma performs **vector similarity searches**:
- **Embedding Model:** `nomic-embed-text` (or `all-minilm` via Ollama) yielding **384-dimension** vectors (or `text-embedding-3-small` compatibility yielding 1536-dimension vectors).
- **Storage:** The `Evidence` model includes a vector column using Prisma's `Unsupported("vector(384)")` helper.
- **Search Query:** Done using raw SQL via Prisma:
  ```sql
  SELECT requirement_id, title, description, (embedding <=> $1::vector) as distance
  FROM "ComplianceRequirement"
  ORDER BY distance ASC
  LIMIT 3;
  ```

---

## 4. Cryptographic Audit Logging (SHA-256 Chaining)

To guarantee that audit logs are tamper-evident, the platform implements a hash-chaining protocol:

### Chaining Algorithm
For each new log entry $L_n$:
1. Fetch the hash $H_{n-1}$ of the previous log entry $L_{n-1}$.
2. Concatenate the fields of $L_n$: `organizationId` + `userId` + `action` + `resourceType` + `resourceId` + `details` + `timestamp` + $H_{n-1}$.
3. Compute $H_n = \text{SHA-256}(\text{concatenation})$.
4. Store $H_n$ in the `currentHash` database column.

### Verification Engine
An automated tRPC procedure `audit.verifyChain` runs when triggered by the admin or auditor. The system scans entries sequentially:
- Recalculates the hash chain starting from the genesis block (the first entry, where $H_0 = \text{null}$).
- If any calculated hash does not match the stored database hash, the verification fails, pointing out the exact index and ID of the tampered log.

---

## 5. Local AI & RAG Pipeline (Ollama)

All artificial intelligence capabilities run on-premises via **Ollama**.

### Prompt Pipeline
- **System Prompt Templates:** Structured XML templates specifying strict format constraints (Markdown output, legal terminology, clause citations).
- **RAG Architecture:**
  1. The text of the **DPDP Act 2023** is parsed and split into chunks of 500 characters with 100-character overlaps.
  2. Embeddings are created and stored in the database.
  3. When generating a policy (e.g., "Access Control Policy"), pgvector queries for sections of the DPDP Act related to "access restrictions" and "data principal rights."
  4. Retrieved sections are injected into the Ollama prompt context:
     ```
     Context from DPDP Act 2023:
     [Retrieved Snippets]
     
     Draft a detailed Access Control Policy matching these requirements.
     ```

---

## 6. Deployment Architecture (Docker Compose)

The multi-container architecture is initialized using a single `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  caddy:
    image: caddy:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    depends_on:
      - nextjs

  nextjs:
    build: ./app
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://dharma:password@postgres:5432/dharma_db
      - REDIS_URL=redis://redis:6379
      - MINIO_ENDPOINT=minio
    depends_on:
      - postgres
      - redis

  postgres:
    image: ankane/pgvector:v0.5.1 # PostgreSQL pre-packaged with pgvector
    environment:
      - POSTGRES_DB=dharma_db
      - POSTGRES_USER=dharma
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
```

---

## 7. Performance & Security Specifications

### Performance Targets
- **tRPC API Overhead:** <10ms latency.
- **pgvector Search Time:** <50ms for collections of up to 100,000 embeddings.
- **Ollama Generation Latency:** ~5-15 seconds depending on hardware capacity.
- **Background Worker Latency:** Queue pickup delay < 500ms.

### Security Controls
- **Data Sovereignty:** All data is processed locally. External network access is disabled for `ollama` and `postgres` containers.
- **Access Control:** All tRPC endpoints require a valid session context check. Organization ID filters are enforced at the database layer.
- **Presigned URLs:** File access relies on 15-minute expiry presigned URLs generated on the server.
