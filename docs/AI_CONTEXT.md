# Dharma — Master AI Context

This document combines the refined, production-optimized blueprints for **Dharma**, a self-hosted compliance automation platform for Indian MSMEs. It acts as the single source of truth for AI code generators.

---

## 1. PRD (Product Requirements)

**App:** Dharma  
**Tagline:** Self‑hosted compliance automation for Indian MSMEs.  
**Problem:** MSMEs lack affordable, private, AI‑powered tools to comply with DPDP Act, ISO 27001, SOC 2.  
**Users:** Founders, CTOs, compliance officers, auditors (capstone evaluator = security professional).  
**Core Features:**
- Framework library (DPDP, ISO 27001, SOC 2) with predefined controls.
- Manual evidence upload with secure storage (MinIO).
- AI evidence‑to‑control mapping (local Ollama + pgvector).
- Immutable audit log (SHA‑256 hash chain).
- AI policy draft generator (RAG over regulation texts).
- One‑click audit report export (signed PDF).
- Full Docker Compose self‑hosting (zero data leakage).  
**User Stories:**
- Founder uploads MFA screenshot → AI suggests control → accepts → audit log updated.
- Compliance manager generates privacy policy draft via AI → edits in rich editor → publishes.
- Auditor receives time‑limited read‑only link → views evidence, logs, reports.  
**Success Metrics:** Reduce manual compliance effort by 80%; audit log tamper‑proof verification; pass OWASP ZAP scan with no highs.

---

## 2. TRD (Technical Requirements)

| Layer | Technology | Reason |
|-------|------------|--------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Framer Motion | Modern, type‑safe, accessible, animated |
| Backend | tRPC v11 (on Next.js) | End‑to‑end typesafety, no REST boilerplate |
| Database | PostgreSQL 16 + pgvector extension | Reliable, vector search for AI |
| ORM | Prisma | Type‑safe DB, easy migrations |
| Cache/Queue | Redis + BullMQ | Async jobs (AI, PDF export) |
| File Storage | MinIO (S3‑compatible) | Self‑hosted, encrypted, presigned URLs |
| Auth | NextAuth.js (Google OAuth + magic link) | JWT session with orgId + role |
| AI Runtime | Ollama + Llama 3 8B (local) + LangChain.js | Zero API cost, privacy |
| Deployment | Docker Compose (all services) | Self‑hosted one‑command |
| Demo Host | Railway or Fly.io (free tier) | Live demo URL |
| CI | GitHub Actions + Playwright | E2E tests on push |

**Architecture (text):**
```
User → Caddy (HTTPS) → Next.js server
                          ├── tRPC handlers → Prisma → PostgreSQL + pgvector
                          ├── Redis (BullMQ) → Worker processes
                          └── MinIO (evidence files)
Worker → Ollama (AI)
```

---

## 3. App Flow (Navigation)

**Routes (Next.js App Router):**
- `/` → Landing page
- `/auth/login` → Sign‑in (Google OAuth, magic link)
- `/dashboard` → Compliance readiness score, gap heatmap, quick actions
- `/frameworks` → List of active frameworks
- `/frameworks/[id]` → Controls of a framework (filterable by domain)
- `/controls/[id]` → Control detail, evidence list, AI suggestions
- `/evidence/upload` → Drag‑and‑drop upload, manual linking
- `/policies` → Policy list, versions
- `/policies/new` → AI policy draft wizard (type → questions → editor)
- `/audit/report` → Export button, download link
- `/audit/portal/[token]` → Read‑only auditor view (time‑limited)
- `/settings` → Account, integrations, API keys

**Key user flows:**
1. Evidence: Dashboard → Controls → specific control → Upload → AI mapping → accept.
2. Policy: Policies → New → select type → answer questions → AI draft → edit in TipTap → publish.
3. Audit: Dashboard → Export → worker generates PDF → download.

**Global behavior:** All mutations show toast (Sonner). Empty states have illustration + CTA. 404 page minimal.

---

## 4. UI/UX Brief (Design System)

**Tokens:**
- **Style:** Minimal, professional, security‑first.
- **Font:** Inter (headings `font-semibold`, body `font-normal`).
- **Colors:**
  - Primary: `amber-600` (`#D97706` deep saffron)
  - Accent: `emerald-500` (`#10B981`)
  - Background: `stone-50` (light), `stone-950` (dark)
  - Text: `stone-900` (light), `stone-100` (dark)
- **Spacing:** Tailwind defaults, generous padding (`p-6`, `p-8`).
- **Radius:** `rounded-xl` cards, `rounded-lg` buttons.
- **Shadows:** `shadow-sm` default, `shadow-md` hover.
- **Icons:** `lucide-react` (size `w-5 h-5`).
- **Motion:** Framer Motion – fade‑up on scroll, hover scale `1.02` on cards, subtle pulse for AI processing.
- **Dark mode:** System preference + manual toggle (`next-themes`).

**Component palette (from shadcn/ui):**  
`Button`, `Card`, `Dialog`, `Sheet` (mobile nav), `Form` (with React Hook Form + Zod), `Skeleton`, `Table`, `Tabs`, `Toast` (Sonner), `Tooltip`, `Badge`, `Progress`.

**Landing page specific:** Hero with abstract animated shield icon (Framer Motion), trust badges, feature cards with hover lift.

---

## 5. Backend Schema (Prisma – Complete)

```prisma
// Dharma – Prisma Schema
// PostgreSQL + pgvector extension required.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Organization {
  id        String   @id @default(cuid())
  name      String
  users     User[]
  frameworks Framework[]
  evidences  Evidence[]
  policies   Policy[]
  auditLogs  AuditLog[]
}

model User {
  id             String       @id @default(cuid())
  email          String       @unique
  name           String?
  role           Role         @default(VIEWER)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
}

enum Role {
  ADMIN
  COMPLIANCE_MANAGER
  VIEWER
}

model Framework {
  id             String    @id @default(cuid())
  name           String    // e.g., "DPDP Act 2023"
  version        String
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  controls       Control[]
}

model Control {
  id          String        @id @default(cuid())
  frameworkId String
  framework   Framework     @relation(fields: [frameworkId], references: [id])
  domain      String
  title       String
  description String
  status      ControlStatus @default(NOT_STARTED)
  evidence    Evidence[]
}

enum ControlStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLIANT
  NOT_APPLICABLE
}

model Evidence {
  id             String       @id @default(cuid())
  controlId      String
  control        Control      @relation(fields: [controlId], references: [id])
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  type           EvidenceType
  filePath       String       // MinIO object key
  fileName       String
  summary        String?      // AI-generated summary
  collectedAt    DateTime     @default(now())
  expiresAt      DateTime?
  embedding      Unsupported("vector(1536)")? // pgvector, 1536-dim for OpenAI embedding size
}

enum EvidenceType {
  SCREENSHOT
  POLICY_DOC
  API_RESPONSE
  LOG
  OTHER
}

model Policy {
  id             String     @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  title          String
  content        String     // Markdown
  version        Int        @default(1)
  isPublished    Boolean    @default(false)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  policyType     PolicyType
}

enum PolicyType {
  PRIVACY_POLICY
  DATA_RETENTION
  ISMS_POLICY
  COOKIE_POLICY
  DPA
  OTHER
}

model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  userId         String
  action         String   // e.g., "EVIDENCE_UPLOAD"
  entity         String   // "Evidence", "Control"
  entityId       String
  changes        Json?
  timestamp      DateTime @default(now())
  previousHash   String?  // SHA-256 of previous log entry
}

// For AI policy drafting RAG
model RegulationSnippet {
  id        String   @id @default(cuid())
  source    String   // "DPDP Act 2023, Section 6(1)"
  content   String
  embedding Unsupported("vector(1536)")?
}
```

---

## 6. Implementation Plan (Exact Build Order)

**Phase 1 – Foundation (Day 1‑2)**
- Scaffold with `create-t3-app` (Next.js App Router, tRPC, Prisma, NextAuth, Tailwind).
- Install shadcn/ui, set theme.
- Configure Prisma schema, run `prisma db push`.
- Setup NextAuth Google OAuth, test login.
- Create base layout: sidebar (`/dashboard` layout), top nav, dark mode toggle.

**Phase 2 – Frameworks & Controls (Day 3‑4)**
- Seed DPDP Act controls (JSON file → Prisma seed).
- Build `framework.router.ts` (list, getById) and `control.router.ts` (list by framework, getById).
- Pages: `/frameworks`, `/frameworks/[id]`, `/controls/[id]` with status badges.

**Phase 3 – Evidence Manual Flow (Day 5‑6)**
- Setup MinIO, env vars.
- `evidence.router.ts`: `upload` (presigned URL or direct stream), `listByControl`, `delete`.
- UI: upload dropzone, evidence table, manual linking to control.

**Phase 4 – Immutable Audit Log (Day 7‑8)**
- Prisma middleware: log all mutations on Evidence, Control status, Policy.
- Implement hash chain: compute SHA‑256 of previous log, store as `previousHash`.
- `audit.router.ts`: `getLogs`, `verifyIntegrity`.
- Show log on control detail page.

**Phase 5 – AI Evidence Mapping (Day 9‑11)**
- Start Ollama, pull `llama3`.
- Worker (`worker/classification.ts` via BullMQ): accept `evidenceId`, generate summary/embedding (via Ollama), upsert embedding, cosine similarity search against controls, return top‑3 suggestions.
- `evidence.router.ts`: `requestAIMapping`, `acceptMapping`.
- UI: "AI Suggestions" panel on evidence/control detail; accept/reject buttons.

**Phase 6 – AI Policy Drafting (Day 12‑14)**
- Store DPDP Act snippets in `RegulationSnippet` with embeddings.
- Worker (`worker/policyGen.ts`): RAG – retrieve relevant snippets, build prompt, call Ollama, return markdown.
- `policy.router.ts`: `generateDraft`.
- UI: wizard (type → questions → TipTap editor) with AI draft.

**Phase 7 – Audit Report & Portal (Day 15‑16)**
- `report.router.ts`: `exportReport` – gather all controls/evidence/logs, generate PDF (use `@react-pdf/renderer`), upload to MinIO, return signed URL.
- Auditor portal: create JWT with expiry, `/audit/portal/[token]` read‑only view.

**Phase 8 – Polish & Testing (Day 17‑19)**
- E2E tests with Playwright (login, evidence upload, AI mapping acceptance).
- Security: helmet, CSP, rate limiting.
- Responsive adjustments, micro‑animations.
- Docker Compose file (caddy, nextjs, worker, postgres, redis, minio, ollama).

**Phase 9 – Landing Page & Demo (Day 20‑21)**
- Build landing page (`/`) using Framer Motion, shadcn/ui, as per UI/UX brief.
- Record 5‑minute demo.
- Write README with architecture diagram, setup steps.
