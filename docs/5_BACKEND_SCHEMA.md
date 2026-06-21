# 5. Backend Schema & API Specifications

## Dharma — Database Design & API Specifications

---

## 1. Database Overview

### Database Engine: PostgreSQL + pgvector
- **PostgreSQL Version:** 15+
- **Extension Required:** `pgvector` (enables vector storage and semantic search indices)
- **ORM:** Prisma 5.x with custom schema extensions.

### Database Design Principles
1. **Strict Multi-Tenant Containment:** Every business-related row (Frameworks, Controls, Evidence, Policies, AuditLogs) must link back to an `Organization`. Access control is enforced via tRPC context organization filtering.
2. **Immutable Log Chain:** The `AuditLog` table maintains a cryptographic hash chain using SHA-256 to ensure log entries are tamper-evident.
3. **Local Vector Search:** Embedding vectors (384-dimension) are saved in the database for mapping evidence and retrieving regulation snippets for RAG.

---

## 2. Prisma Database Schema (`schema.prisma`)

```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector] // Enable pgvector extension
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

// 1. Organization Model
model Organization {
  id          String      @id @default(cuid())
  name        String
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  
  users       User[]
  frameworks  Framework[]
  evidences   Evidence[]
  policies    Policy[]
  auditLogs   AuditLog[]
  auditorKeys AuditorAccess[]
}

// 2. User Model (NextAuth compatible)
model User {
  id             String       @id @default(cuid())
  email          String       @unique
  name           String?
  role           Role         @default(VIEWER)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  accounts       Account[]
  sessions       Session[]
  auditLogs      AuditLog[]

  @@index([organizationId])
}

enum Role {
  ADMIN
  COMPLIANCE_MANAGER
  VIEWER
}

// 3. NextAuth Account Model
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

// 4. NextAuth Session Model
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// 5. Compliance Framework Model
model Framework {
  id             String       @id @default(cuid())
  name           String       // e.g. "DPDP Act 2023", "ISO 27001:2022"
  version        String       @default("1.0")
  createdAt      DateTime     @default(now())
  
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  controls       Control[]

  @@unique([organizationId, name])
  @@index([organizationId])
}

// 6. Control Requirement Model
model Control {
  id          String        @id @default(cuid())
  frameworkId String
  framework   Framework     @relation(fields: [frameworkId], references: [id], onDelete: Cascade)
  domain      String        // e.g., "Consent & Notice", "Logical Access"
  title       String        // e.g., "MFA Configuration"
  description String        @db.Text
  status      ControlStatus @default(NOT_STARTED)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  
  evidence    Evidence[]

  @@index([frameworkId])
}

enum ControlStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLIANT
  NOT_APPLICABLE
}

// 7. Evidence Model (Object path & Vector embedding)
model Evidence {
  id             String       @id @default(cuid())
  controlId      String
  control        Control      @relation(fields: [controlId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  fileName       String
  filePath       String       // MinIO Storage Key (UUID string)
  type           EvidenceType
  summary        String?      @db.Text // AI-generated text summary
  collectedAt    DateTime     @default(now())
  expiresAt      DateTime?
  
  // Custom unsupported type for pgvector embedding field
  embedding      Unsupported("vector(384)")? 

  @@index([controlId])
  @@index([organizationId])
}

enum EvidenceType {
  SCREENSHOT
  POLICY_DOC
  API_RESPONSE
  LOG_EXCERPT
  OTHER
}

// 8. Security Policy Model (TipTap editor content)
model Policy {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  title          String
  content        String       @db.Text // Markdown/JSON editor content
  version        Int          @default(1)
  isPublished    Boolean      @default(false)
  policyType     PolicyType
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId])
}

enum PolicyType {
  PRIVACY_POLICY
  DATA_RETENTION
  ACCESS_CONTROL
  INCIDENT_RESPONSE
  OTHER
}

// 9. Verifiable Cryptographic Audit Log
model AuditLog {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation(fields: [userId], references: [id])
  
  action         String       // e.g. "EVIDENCE_UPLOAD", "POLICY_PUBLISH"
  entity         String       // e.g. "Evidence", "Policy"
  entityId       String
  changes        Json?        // JSON representation of diff
  timestamp      DateTime     @default(now())
  
  previousHash   String?      // SHA-256 hash of previous block entry
  currentHash    String       // SHA-256 hash of current block entry

  @@index([organizationId])
  @@index([timestamp])
}

// 10. Regulation Snippet (Vector storage for RAG queries)
model RegulationSnippet {
  id             String                     @id @default(cuid())
  frameworkName  String                     // "DPDP Act 2023"
  sectionNumber  String                     // "Section 6"
  content        String                     @db.Text
  embedding      Unsupported("vector(384)") // Vector embedding of snippet
}

// 11. Auditor Access Tokens
model AuditorAccess {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  token          String       @unique // Secure JWT
  expiresAt      DateTime
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())

  @@index([organizationId])
}
```

---

## 3. Database Indexes

Prisma will create default primary and index constraints. In PostgreSQL, we must initialize IVFFlat or HNSW vector indices manually using custom migrations:

```sql
-- Create Vector index for pgvector cosine distance on Evidence embeddings
CREATE INDEX idx_evidence_embedding_cosine ON "Evidence" USING hnsw (embedding vector_cosine_ops);

-- Create Vector index for pgvector cosine distance on RegulationSnippet embeddings
CREATE INDEX idx_snippet_embedding_cosine ON "RegulationSnippet" USING hnsw (embedding vector_cosine_ops);
```

---

## 4. tRPC API Specifications

Dharma implements standard **tRPC v11** routes. Procedures retrieve organization ID directly from the session context to prevent unauthorized multi-tenant leaks.

### 1. Framework Router (`framework`)
- **`list` (Query):** Returns active frameworks for the organization.
  - *Output:* `Array<{ id, name, version, progressPercentage, controlCount }>`
- **`getById` (Query):** Details of a framework including controls.
  - *Input:* `{ id: String }`
  - *Output:* `Framework & { controls: Array<Control & { evidenceCount }> }`
- **`create` (Mutation):** Initialize a framework.
  - *Input:* `{ name: String, targetDate?: Date }`
  - *Output:* `Framework` (automatically triggers control seeding via migration data)

### 2. Control Router (`control`)
- **`getById` (Query):** Detailed requirement control state.
  - *Input:* `{ id: String }`
  - *Output:* `Control & { evidence: Array<Evidence>, frameworkName: String }`
- **`updateStatus` (Mutation):** Modify control completion state.
  - *Input:* `{ id: String, status: ControlStatus }`
  - *Output:* `Control` (triggers AuditLog creation)

### 3. Evidence Router (`evidence`)
- **`getUploadUrl` (Mutation):** Generates a presigned upload path for MinIO.
  - *Input:* `{ fileName: String, contentType: String }`
  - *Output:* `{ uploadUrl: String, filePath: String }`
- **`create` (Mutation):** Links uploaded file key to a control and triggers AI analysis.
  - *Input:* `{ controlId: String, fileName: String, filePath: String, type: EvidenceType }`
  - *Output:* `Evidence` (pushes mapping job to BullMQ queue)
- **`list` (Query):** Fetch all uploaded evidence for the organization.
- **`getAIRecommendations` (Query):** Returns top 3 control requirements matched by pgvector.
  - *Input:* `{ evidenceId: String }`
  - *Output:* `Array<{ controlId, title, distance }>`

### 4. Policy Router (`policy`)
- **`list` (Query):** Returns list of drafted and published policies.
- **`create` (Mutation):** Save a manual or generated policy.
  - *Input:* `{ title: String, content: String, policyType: PolicyType }`
  - *Output:* `Policy`
- **`triggerAIGeneration` (Mutation):** Enqueues a policy creation request using local RAG snippets.
  - *Input:* `{ policyType: PolicyType, contextInput: String }`
  - *Output:* `{ jobId: String }` (client polls for BullMQ completion state)

### 5. Audit Log Router (`audit`)
- **`list` (Query):** Returns history of audit logs.
- **`verifyIntegrity` (Query):** Recalculates the SHA-256 hash chain.
  - *Output:* `{ isValid: Boolean, brokenLogId: String | null, calculatedCount: Int }`
