# Graph Report - /Users/hemgabhawala/Desktop/Hem/dharma  (2026-07-10)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1036 nodes · 2188 edges · 143 communities (54 shown, 89 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a66d0c63`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- button.tsx
- classification.ts
- auth.ts
- compilerOptions
- scripts
- EvidenceTable.tsx
- db.ts
- trpc.ts
- cn
- ControlDetailModal.tsx
- dialog.tsx
- index.ts
- index.ts
- evidence.ts
- env.ts
- EvidenceUploadModal.tsx
- awsConnector.ts
- dependencies
- audit-log.ts
- page.tsx
- ConnectorConfigWizard.tsx
- EntitlementService
- route.ts
- minioClient.ts
- billing.ts
- settings.ts
- page.tsx
- report.ts
- devDependencies
- seed-frameworks.ts
- connector.ts
- auditorPackage.ts
- docker-entrypoint.sh
- EvidenceList.tsx
- evidence.ts
- audit.ts
- @prisma/client
- health.ts
- onboarding.ts
- next-auth.d.ts
- middleware.ts
- seed-regulation.ts
- seed-templates.ts
- page.tsx
- OverallReadinessScore.tsx
- handlebars
- seed-plans.ts
- backup-all.sh
- backup-pg.sh
- init-ollama.sh
- restore-pg.sh
- validate-docker-env.sh
- layout.tsx
- archiver
- @aws-sdk/client-cloudtrail
- @aws-sdk/client-config-service
- @aws-sdk/client-s3
- bullmq
- class-variance-authority
- clsx
- crypto-js
- date-fns
- eslint
- eslint-config-next
- identity-obj-proxy
- ioredis
- jest
- lucide-react
- minio
- next
- next-auth
- @next-auth/prisma-adapter
- next.config.js
- next-env.d.ts
- next-themes
- node-forge
- nodemailer
- @octokit/rest
- pdf-parse
- pdfkit
- @radix-ui/react-checkbox
- @radix-ui/react-label
- @radix-ui/react-slot
- react-dom
- react-dropzone
- @react-pdf/renderer
- recharts
- sonner
- stripe
- @stripe/react-stripe-js
- @stripe/stripe-js
- tailwind-merge
- @tanstack/react-query
- tesseract.js
- tiptap-markdown
- @tiptap/react
- @tiptap/starter-kit
- @trpc/client
- @trpc/react-query
- @types/pdf-parse
- zod
- zustand
- @playwright/test
- postcss
- prisma
- tailwindcss
- tailwindcss-animate
- autoprefixer
- @testing-library/react
- @testing-library/user-event
- ts-jest
- ts-node
- tsx
- @types/archiver
- @types/crypto-js
- @types/handlebars
- @types/jest
- @types/node
- @types/node-forge
- @types/nodemailer
- @types/pdfkit
- @types/react
- @types/react-dom
- @types/react-dropzone
- @types/uuid
- backup-minio.sh
- check-ollama-models.sh
- init-minio.sh
- restore-minio.sh
- connectorQueue.ts
- tailwind.config.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 46 edges
2. `Button` - 45 edges
3. `Card` - 40 edges
4. `api` - 39 edges
5. `CardContent` - 38 edges
6. `CardHeader` - 37 edges
7. `Badge()` - 36 edges
8. `CardTitle` - 36 edges
9. `CardDescription` - 26 edges
10. `scripts` - 23 edges

## Surprising Connections (you probably didn't know these)
- `useDialog()` --references--> `react`  [EXTRACTED]
  src/components/ui/dialog.tsx → package.json
- `createCaller()` --indirect_call--> `appRouter`  [INFERRED]
  tests/evidence-router.test.ts → src/server/routers/index.ts
- `createCaller()` --indirect_call--> `appRouter`  [INFERRED]
  tests/evidence.test.ts → src/server/routers/index.ts
- `createCaller()` --indirect_call--> `appRouter`  [INFERRED]
  tests/framework.test.ts → src/server/routers/index.ts
- `main()` --references--> `@prisma/client`  [EXTRACTED]
  prisma/seed-regulation.ts → package.json

## Import Cycles
- None detected.

## Communities (143 total, 89 thin omitted)

### Community 0 - "button.tsx"
Cohesion: 0.05
Nodes (57): authErrorCopy, ACTION_CONFIG, AuditLogEntry, AuditLogRow(), getActionConfig(), AISuggestionsPanel(), AISuggestionsPanelProps, matchColour() (+49 more)

### Community 1 - "classification.ts"
Cohesion: 0.06
Nodes (38): InferenceProvider, OllamaProvider, OpenAICompatibleProvider, AiProviderConfig, LocalSmallMode, OllamaMode, providerCache, RemoteOptInMode (+30 more)

### Community 2 - "auth.ts"
Cohesion: 0.07
Nodes (20): metadata, mono, sans, Providers(), stripePromise, StripeProvider(), UpgradeBanner(), UpgradeBannerHeader() (+12 more)

### Community 3 - "compilerOptions"
Cohesion: 0.06
Nodes (35): config, createJestConfig, jestConfig(), dom, dom.iterable, es2022, jest, next-env.d.ts (+27 more)

### Community 4 - "scripts"
Cohesion: 0.06
Nodes (31): description, engines, node, name, prisma, seed, private, scripts (+23 more)

### Community 5 - "EvidenceTable.tsx"
Cohesion: 0.14
Nodes (20): EvidenceTableProps, TYPE_CONFIG, ControlDetailModal(), ControlRow, ControlTable(), ControlTableProps, STATUS_CONFIG, BillingHistory() (+12 more)

### Community 6 - "db.ts"
Cohesion: 0.11
Nodes (8): globalForRedis, importRouter, marketplaceRouter, ImportFrameworkInput, ImportService, MarketplaceService, setupGracefulShutdown(), protectedProcedure

### Community 7 - "trpc.ts"
Cohesion: 0.11
Nodes (20): handler(), appRouter, CreateContextOptions, createInnerTRPCContext(), createTRPCContext(), enforceAdminRole, enforceAuthenticatedUser, enforceManagementRole (+12 more)

### Community 8 - "cn"
Cohesion: 0.13
Nodes (21): AuditLogViewer(), EvidenceTable(), FrameworkCard(), FrameworkCardProps, getProgressStatus(), StatPill(), DomainBreakdown(), DomainBreakdownItem (+13 more)

### Community 9 - "ControlDetailModal.tsx"
Cohesion: 0.11
Nodes (23): react, react, EVIDENCE_TYPES, EvidenceUploadFormProps, UploadState, ControlDetailModalProps, STATUS_BADGE, STATUS_OPTIONS (+15 more)

### Community 10 - "dialog.tsx"
Cohesion: 0.12
Nodes (20): AddFrameworkModal(), AddFrameworkModalProps, PREDEFINED_FRAMEWORKS, ImportModal(), ImportModalProps, DialogContent, DialogContentProps, DialogContext (+12 more)

### Community 11 - "index.ts"
Cohesion: 0.16
Nodes (19): decryptCredential(), encryptCredential(), getKey(), AWSConfig, CheckResult, runAWSConnector(), CheckResult, GitHubConfig (+11 more)

### Community 12 - "index.ts"
Cohesion: 0.13
Nodes (16): controlRouter, ControlWithEvidence, dashboardRouter, DashboardStats, entitlementRouter, FrameworkJsonControl, FrameworkJsonData, FrameworkJsonDomain (+8 more)

### Community 13 - "evidence.ts"
Cohesion: 0.19
Nodes (14): signPdf(), uploadSignedPdf(), verifyPdfSignature(), buildStorageKey(), deleteObject(), generatePresignedDownloadUrl(), generatePresignedUploadUrl(), getObjectMetadata() (+6 more)

### Community 14 - "env.ts"
Cohesion: 0.20
Nodes (12): AppEnv, env, envSchema, AnchorManifest, anchorRootHash(), computeRootHash(), RootHashResult, submitToOpenTimestamps() (+4 more)

### Community 15 - "EvidenceUploadModal.tsx"
Cohesion: 0.21
Nodes (14): EvidenceUploadModalProps, uploadFormSchema, UploadFormValues, OrganizationSetupStepProps, FormControl, FormDescription, FormField(), FormFieldContext (+6 more)

### Community 16 - "awsConnector.ts"
Cohesion: 0.21
Nodes (8): assumeConnectorRole(), AWSConnector, AwsConnectorConfig, credentialsToClientConfig(), sanitizeAwsError(), connectorRegistry, ConnectorAdapter, EvidenceItem

### Community 17 - "dependencies"
Cohesion: 0.13
Nodes (16): @aws-sdk/client-rds, framer-motion, @hookform/resolvers, dependencies, @aws-sdk/client-rds, @aws-sdk/client-sts, framer-motion, @hookform/resolvers (+8 more)

### Community 18 - "audit-log.ts"
Cohesion: 0.22
Nodes (10): main(), prisma, seedDatabase(), AuditWriter, computeAuditHash(), createAuditLog(), HashableAuditEntry, sortObjectKeys() (+2 more)

### Community 19 - "page.tsx"
Cohesion: 0.13
Nodes (13): CompletionStep(), FrameworkSelectionStep(), OrganizationSetupStep(), QuickStartStep(), TeamSetupStep(), AvailableFrameworks, FrameworkKey, FrameworkSelectionInput (+5 more)

### Community 20 - "ConnectorConfigWizard.tsx"
Cohesion: 0.19
Nodes (8): CONNECTOR_TYPES, ConnectorConfigWizard(), ConnectorConfigWizardProps, ConnectorsList(), Checkbox, Label, labelVariants, useConnectors()

### Community 21 - "EntitlementService"
Cohesion: 0.23
Nodes (7): createEntitlementMiddleware(), createFeatureGatingMiddleware(), EntitlementService, FREE_TIER_FEATURES, FREE_TIER_LIMITS, ResourceType, t

### Community 22 - "route.ts"
Cohesion: 0.26
Nodes (9): checkMinio(), checkOllama(), checkPostgres(), checkRedis(), GET(), ServiceCheck, withTimeout(), LogFn (+1 more)

### Community 23 - "minioClient.ts"
Cohesion: 0.27
Nodes (5): testMinio(), GET(), generatePresignedUploadUrl(), initializeBucket(), minioClient

### Community 24 - "billing.ts"
Cohesion: 0.31
Nodes (6): webhookSecret, cancelSubscription(), createCheckoutSession(), stripe, updateSubscription(), billingRouter

### Community 25 - "settings.ts"
Cohesion: 0.33
Nodes (7): GET(), invalidateProviderCache(), generateAuditorExchangeCode(), generateAuditorSessionToken(), hashAuditorToken(), settingsRouter, adminProcedure

### Community 26 - "page.tsx"
Cohesion: 0.31
Nodes (5): MarketplaceGrid(), MarketplaceGridProps, MarketplaceItem, MarketplaceSidebar(), MarketplaceSidebarProps

### Community 27 - "report.ts"
Cohesion: 0.33
Nodes (6): ReportDocument(), ReportDocumentProps, styles, aggregateReportData(), ReportData, reportRouter

### Community 28 - "devDependencies"
Cohesion: 0.22
Nodes (9): dotenv-cli, jest-environment-jsdom, devDependencies, dotenv-cli, jest-environment-jsdom, @testing-library/jest-dom, typescript, @testing-library/jest-dom (+1 more)

### Community 29 - "seed-frameworks.ts"
Cohesion: 0.28
Nodes (8): ControlData, DomainData, FRAMEWORK_FILES, FrameworkData, loadFrameworkData(), main(), prisma, seedFrameworkForOrg()

### Community 30 - "connector.ts"
Cohesion: 0.39
Nodes (6): getConnectorAdapter(), decryptConnectorConfig(), encryptConnectorConfig(), getEncryptionKey(), ConfigSchema, connectorRouter

### Community 31 - "auditorPackage.ts"
Cohesion: 0.36
Nodes (8): archiver, AuditorPackageJobData, auditorPackageQueue, escHtml(), generateIndexHtml(), processAuditorPackageJob(), redisConnection(), startAuditorPackageWorker()

### Community 32 - "docker-entrypoint.sh"
Cohesion: 0.46
Nodes (7): main(), run_migrations(), run_seed(), docker-entrypoint.sh script, wait_for_ollama(), wait_for_postgres(), wait_for_redis()

### Community 33 - "EvidenceList.tsx"
Cohesion: 0.36
Nodes (5): EvidenceList(), EvidenceListProps, EvidenceUploadModal(), DialogDescription, useEvidence()

### Community 34 - "evidence.ts"
Cohesion: 0.25
Nodes (7): CreateEvidenceInput, CreateEvidenceInputSchema, EvidenceTypeEnum, GetUploadUrlInput, GetUploadUrlInputSchema, ListEvidenceInput, ListEvidenceInputSchema

### Community 35 - "audit.ts"
Cohesion: 0.39
Nodes (6): auditRouter, AnchorJobData, anchorQueue, processAnchorJob(), redisConnection(), startAnchorWorker()

### Community 36 - "@prisma/client"
Cohesion: 0.38
Nodes (6): @prisma/client, @prisma/client, getEmbedding(), main(), OllamaEmbedResponse, vectorToSql()

### Community 38 - "onboarding.ts"
Cohesion: 0.40
Nodes (4): FrameworkSelectionSchema, onboardingRouter, TODO: Send invitation email via SendGrid or similar, mockPrisma

### Community 39 - "next-auth.d.ts"
Cohesion: 0.33
Nodes (5): JWT, next-auth, next-auth/jwt, Session, User

### Community 40 - "middleware.ts"
Cohesion: 0.50
Nodes (4): config, isRateLimited(), middleware(), rateLimitMap

### Community 41 - "seed-regulation.ts"
Cohesion: 0.60
Nodes (4): chunkText(), generateEmbedding(), main(), prisma

### Community 45 - "handlebars"
Cohesion: 0.67
Nodes (3): handlebars, handlebars, renderTemplate()

## Knowledge Gaps
- **330 isolated node(s):** `config`, `rateLimitMap`, `config`, `nextConfig`, `name` (+325 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **89 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `scripts`, `ControlDetailModal.tsx`, `@prisma/client`, `handlebars`, `archiver`, `@aws-sdk/client-cloudtrail`, `@aws-sdk/client-config-service`, `@aws-sdk/client-s3`, `bullmq`, `class-variance-authority`, `clsx`, `crypto-js`, `date-fns`, `ioredis`, `lucide-react`, `minio`, `next`, `next-auth`, `@next-auth/prisma-adapter`, `next-themes`, `node-forge`, `nodemailer`, `@octokit/rest`, `pdf-parse`, `pdfkit`, `@radix-ui/react-checkbox`, `@radix-ui/react-label`, `@radix-ui/react-slot`, `react-dom`, `react-dropzone`, `@react-pdf/renderer`, `recharts`, `sonner`, `stripe`, `@stripe/react-stripe-js`, `@stripe/stripe-js`, `tailwind-merge`, `@tanstack/react-query`, `tesseract.js`, `tiptap-markdown`, `@tiptap/react`, `@tiptap/starter-kit`, `@trpc/client`, `@trpc/react-query`, `@types/pdf-parse`, `zod`, `zustand`?**
  _High betweenness centrality (0.317) - this node is a cross-community bridge._
- **Why does `react` connect `ControlDetailModal.tsx` to `dependencies`, `dialog.tsx`, `EvidenceList.tsx`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `scripts`, `eslint`, `eslint-config-next`, `identity-obj-proxy`, `jest`, `@playwright/test`, `postcss`, `prisma`, `tailwindcss`, `tailwindcss-animate`, `autoprefixer`, `@testing-library/react`, `@testing-library/user-event`, `ts-jest`, `ts-node`, `tsx`, `@types/archiver`, `@types/crypto-js`, `@types/handlebars`, `@types/jest`, `@types/node`, `@types/node-forge`, `@types/nodemailer`, `@types/pdfkit`, `@types/react`, `@types/react-dom`, `@types/react-dropzone`, `@types/uuid`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **What connects `config`, `rateLimitMap`, `config` to the rest of the system?**
  _332 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `button.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05450581395348837 - nodes in this community are weakly interconnected._
- **Should `classification.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.061952074810052604 - nodes in this community are weakly interconnected._
- **Should `auth.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07195121951219512 - nodes in this community are weakly interconnected._