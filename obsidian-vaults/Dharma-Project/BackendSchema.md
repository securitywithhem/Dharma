# Dharma Future Scope – Extended Backend Schema (Prisma)

*Additions to the base schema from Phase 3 Part 1. All new models are tenant-scoped unless noted otherwise.*

```prisma
// ----- Phase 3b: Billing & Subscription -----
model Plan \{
  id          String   @id @default(cuid())
  name        String   // "free", "pro", "enterprise"
  limits      Json     // \{ users: 5, frameworks: 3, storageMb: 100 \}
  stripePriceId String? // for paid plans
  createdAt   DateTime @default(now())
  organizations Organization[]
\}

// Add to Organization model:
// planId          String?
// plan            Plan?        @relation(fields: [planId], references: [id])
// stripeCustomerId String?
// stripeSubscriptionId String?

// ----- Phase 3c: Marketplace -----
model MarketplaceItem \{
  id              String   @id @default(cuid())
  type            ItemType // FRAMEWORK, TEMPLATE, CONNECTOR
  name            String
  description     String
  authorId        String   // userId of publisher
  price           Float    @default(0)
  metadata        Json     // framework definition, etc.
  ratings         Float    @default(0)
  downloads       Int      @default(0)
  isPublic        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
\}

enum ItemType \{
  FRAMEWORK
  TEMPLATE
  CONNECTOR
\}

// Imported items create copy in org, tracked via:
model ImportedItem \{
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  marketplaceItemId String?
  sourceItem     MarketplaceItem? @relation(fields: [marketplaceItemId], references: [id])
  importedAt     DateTime @default(now())
  @@unique([organizationId, marketplaceItemId])
\}

// ----- Phase 4: Cloud Connectors & Automation -----
model Connector \{
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  type           ConnectorType
  name           String
  config         Json     // encrypted credentials, settings
  status         ConnectorStatus @default(DISCONNECTED)
  lastSyncAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  evidenceMappings EvidenceMapping[]
\}

enum ConnectorType \{
  AWS
  AZURE
  GCP
  GITHUB
  OKTA
  JIRA
\}

enum ConnectorStatus \{
  CONNECTED
  DISCONNECTED
  ERROR
\}

model EvidenceMapping \{
  id            String    @id @default(cuid())
  connectorId   String
  connector     Connector @relation(fields: [connectorId], references: [id])
  controlId     String
  control       Control   @relation(fields: [controlId], references: [id])
  evidenceType  String    // e.g., "aws_s3_encryption"
  schedule      String?   // cron expression
  lastCollectedAt DateTime?
  createdAt     DateTime  @default(now())
\}

// Existing Evidence model should have a 'source' field added: "manual" | "auto"

// ----- Phase 5: Penetration Testing & Vulns -----
model PenTest \{
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  target         String   // domain or IP
  type           PenTestType
  status         PenTestStatus
  result         Json?    // raw scan output
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  vulnerabilities Vulnerability[]
\}

enum PenTestType \{
  EXTERNAL_NETWORK
  WEB_APP
\}

enum PenTestStatus \{
  QUEUED
  RUNNING
  COMPLETED
  FAILED
\}

model Vulnerability \{
  id          String   @id @default(cuid())
  penTestId   String?
  penTest     PenTest? @relation(fields: [penTestId], references: [id])
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  controlId   String?
  control     Control? @relation(fields: [controlId], references: [id])
  title       String
  description String
  severity    Severity
  cvssScore   Float?
  status      VulnStatus @default(OPEN)
  createdAt   DateTime @default(now())
\}

enum Severity \{
  NONE
  LOW
  MEDIUM
  HIGH
  CRITICAL
\}

enum VulnStatus \{
  OPEN
  IN_PROGRESS
  RESOLVED
  WONT_FIX
\}

// ----- Phase 6: Advanced Frameworks & Cross-Walking -----
// Control model extended with:
// hierarchyPath   Json?  // for nested controls

model ControlMapping \{
  id               String   @id @default(cuid())
  organizationId   String
  sourceControlId  String
  targetControlId  String
  mappingStrength  MappingStrength
  createdAt        DateTime @default(now())
  // relations
  sourceControl    Control @relation("SourceMappings", fields: [sourceControlId], references: [id])
  targetControl    Control @relation("TargetMappings", fields: [targetControlId], references: [id])
  @@unique([organizationId, sourceControlId, targetControlId])
\}

enum MappingStrength \{
  EQUIVALENT
  PARTIAL
  RELATED
\}

// ----- Phase 7: AI Advisor -----
model AIAdvisorSession \{
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  messages       Json     // array of \{ role, content \}
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
\}

model OrganizationEmbedding \{
  id             String   @id @default(cuid())
  organizationId String
  documentType   String   // "control", "evidence", "policy_doc"
  documentId     String   // foreign key to respective table
  embedding      Unsupported("vector(1536)") // requires pgvector
  chunkIndex     Int
  content        String
  createdAt      DateTime @default(now())
\}

// ----- Phase 8: Enterprise & White-Label -----
model OrganizationSettings \{
  id             String   @id @default(cuid())
  organizationId String   @unique
  ssoConfig      Json?    // \{ type: "SAML", metadataUrl, ... \}
  scimEnabled    Boolean  @default(false)
  whiteLabel     Json?    // \{ logoUrl, primaryColor, customDomain, css \}
  auditLogRetentionDays Int @default(365)
\}

model AuditEvent \{
  id             String   @id @default(cuid())
  organizationId String
  actorId        String
  action         String   // "control.updated", "user.invited"
  resourceType   String
  resourceId     String?
  metadata       Json?
  ipAddress      String?
  createdAt      DateTime @default(now())
  @@index([organizationId, createdAt])
\}

// MSSP support
model OrganizationGroup \{
  id             String   @id @default(cuid())
  name           String
  parentOrgId    String?  // MSSP own org
  organizations  Organization[] @relation("GroupOrgs")
\}

// Add to Organization:
// groupId        String?
// group          OrganizationGroup? @relation("GroupOrgs", fields: [groupId], references: [id])}