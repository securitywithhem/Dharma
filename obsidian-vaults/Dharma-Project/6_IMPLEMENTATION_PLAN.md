# 6. Implementation Plan

## Dharma — Development Roadmap & Deployment Strategy

---

## 1. Project Phases & Timeline

Dharma is designed to be built in three progressive phases, leveraging local containerized tools to simplify self-hosting.

- **Phase 0 (MVP Core):** Weeks 1-4. Target: Working self-hosted dashboard, database seeding, tRPC APIs, MinIO object storage, and basic cryptographic logging.
- **Phase 1 (AI Automation):** Weeks 5-8. Target: Local Ollama LLM integration, pgvector similarity mapping, RAG policy drafting, and time-limited auditor link generator.
- **Phase 2 (Enterprise & Hardening):** Weeks 9-12. Target: Docker Compose stabilization, automated backups, and E2E validation.

---

## 2. Week-by-Week Implementation Plan

### Phase 0: Core Foundation (Weeks 1-4)

#### Week 1: Multi-Container Setup & Authentication
- **Objectives:** Initialize monorepo, spin up local services (Postgres, Redis, MinIO, Ollama) via Docker Compose, and configure NextAuth.js.
- **Tasks:**
  1. **Docker Compose Orchestration:**
     - Configure `docker-compose.yml` defining services for `postgres:15-alpine` (with `pgvector` preloaded), `redis:7-alpine`, `minio/minio`, and `ollama/ollama`.
  2. **Next.js & tRPC Initialization:**
     - Bootstrap Next.js 14 App Router project with TypeScript.
     - Configure `tRPC v11` client-server linkages. Initialize base `trpc/server.ts` and React hook queries wrappers.
  3. **Prisma Setup:**
     - Configure `schema.prisma` with 11 core models (Organization, User, Framework, Control, Evidence, Policy, AuditLog, etc.) and pgvector schemas.
     - Deploy initial migration to PostgreSQL.
  4. **NextAuth.js Integration:**
     - Integrate Google OAuth provider and Email magic-link setup.
     - Enforce middleware session checking to redirect unauthenticated requests to `/auth/signin`.

#### Week 2: Framework CRUD & Requirement Seeding
- **Objectives:** Seeding DPDP Act 2023 requirements database tables, and rendering framework progress widgets.
- **Tasks:**
  1. **Seeding Core Regulations:**
     - Write a Prisma seed script parsing structured JSON files containing domains and control requirements for:
       - **Digital Personal Data Protection (DPDP) Act 2023** (Consent & Notice requirements, Data Principal Rights, Data Fiduciary Duties).
       - **ISO 27001:2022** and **SOC 2 Type II** controls.
  2. **tRPC Framework Router:**
     - Implement query procedures `framework.list` and `framework.getById`.
     - Implement mutation procedure `framework.create`.
  3. **Client UI Layouts:**
     - Create Sidebar navigation layout using shadcn/ui panels.
     - Build `/dashboard/frameworks` pages detailing active frameworks cards with progress bars.

#### Week 3: Object Storage Uploads (MinIO)
- **Objectives:** Configure evidence file uploads directly to MinIO utilizing presigned URLs.
- **Tasks:**
  1. **MinIO Storage Client:**
     - Configure S3 client wrapper pointing to local MinIO container using environment variables.
     - Establish initialization hooks to create the `dharma-evidence` bucket if it does not exist.
  2. **Presigned Upload Workflow:**
     - Implement tRPC mutation `evidence.getUploadUrl` returning presigned upload keys.
     - Create frontend dropzone UI (`react-dropzone` integration). Drops initiate direct HTTP PUT uploads bypass to MinIO storage.
  3. **Evidence Record Creation:**
     - Implement tRPC mutation `evidence.create` creating the database row pointing to MinIO key. Renders files list under `/dashboard/evidence`.

#### Week 4: Verifiable Audit Chaining
- **Objectives:** Implement tamper-evident SHA-256 hash chaining on all compliance mutating operations.
- **Tasks:**
  1. **Prisma Audit Middleware:**
     - Implement a post-transaction query hook that intercepts `Evidence`, `Policy`, and `ControlStatus` modifications.
     - Computes the SHA-256 hash of the transaction data concatenated with the hash of the preceding AuditLog row.
     - Inserts the new block containing `previousHash` and `currentHash`.
  2. **Log Verification Procedure:**
     - Implement tRPC query `audit.verifyIntegrity` iterating over audit rows and validating chains.
     - Render verification state indicators (valid ShieldCheck / broken warning panel) on dashboard.

---

### Phase 1: Local AI Integration (Weeks 5-8)

#### Week 5-6: pgvector & Ollama Evidence Mapping
- **Tasks:**
  1. **BullMQ Queue Infrastructure:**
     - Setup Redis BullMQ queues processing background evidence tasks asynchronously.
  2. **Ollama Embedding Worker:**
     - BullMQ worker extracts text from files, requests a vector embedding from local Ollama model (`nomic-embed-text`), and updates pgvector field.
  3. **Similarity Search tRPC:**
     - Implement raw SQL query performing cosine similarity searches matching evidence vectors against control requirements.
     - Renders "AI Suggestions" panel on evidence page listing top 3 recommended control linkages.

#### Week 7-8: RAG Policy Drafting & Auditor Key Portal
- **Tasks:**
  1. **DPDP Act Vector Ingestion:**
     - Seeding regulation clauses chunks with embedding vectors into the database.
  2. **RAG Policy Generation Worker:**
     - BullMQ task accepts a policy request, queries database for relevant regulation snippets, builds local Llama 3 prompt contexts, and generates policy drafts.
  3. **TipTap Workspace:**
     - Stepper form triggering generation, and displaying markdown draft within TipTap editor for review.
  4. **Auditor Access Engine:**
     - Generate time-limited tokens (JWT) granting read-only access to frameworks and logs. Countdown timer header locks view after expiration.

---

## 3. Testing Strategy

### Cryptographic Validation Tests
- Write Jest integration tests that mock tampering (manually altering an AuditLog database entry) and confirm `audit.verifyIntegrity` catches the breakage and isolates the correct ID.

### Background Queue Worker Tests
- Verify BullMQ error handling: Jobs failing (e.g., Ollama container offline) must automatically retry up to 3 times with exponential backoff before marking state as failed in the UI.

### tRPC Access Control Tests
- Write test scripts attempting to invoke tRPC queries using mismatched organization contexts, ensuring the session handler returns strict `UNAUTHORIZED` faults.
