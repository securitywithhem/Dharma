*



# Dharma Future Scope – Technical Requirements Document (TRD)

## Architecture Principles
- **Multi-tenant by default**: All new modules follow the same tenant isolation model established in Phase 3 Part 1 (JWT-scoped, RLS via Prisma extension).
- **Pluggable connectors**: External integrations (cloud, webhook, pen-test) use a standard adapter pattern with typed interfaces.
- **Async & event-driven**: Long-running tasks (scans, imports, AI processing) are handled via a job queue (BullMQ) with PostgreSQL backing.
- **Security-first**: Sensitive credentials (cloud keys) encrypted at rest (AES-256), never logged.

## Multi-Tenancy & Billing (Phase 3b)
- Stripe integration: use checkout sessions, store `stripeCustomerId` and `stripeSubscriptionId` on `Organization`.
- Feature entitlement checked by a middleware looking up subscription plan and limits (stored in `Plan` configuration, not hardcoded).
- Marketplace: package metadata stored in a global `MarketplaceItem` table, cross-org; importing creates a copy in target org.

## Automation & Cloud Connectors (Phase 4)
- Connector interface: `collectEvidence(type: string, config: ConnectorConfig): Promise<Evidence[]>`.
- AWS connector uses SDK v3 with read-only IAM role ARN provided by user (cross-account access).
- Scheduled runners: BullMQ repeatable jobs that query connector, map findings to controls, and update status via API.
- Webhook dispatcher: outgoing HTTP calls with HMAC signature; configurable per org.

## Penetration Testing & Vuln Scanning (Phase 5)
- Lightweight external scan: call an open-source engine (e.g., nuclei) in a sandboxed container, parse results, store as `Vulnerability`.
- Manual findings: simple CRUD with association to control/asset.
- CVSS calculator library to derive severity.

## Advanced Frameworks (Phase 6)
- Control hierarchy: nested JSON field `path` for arbitrary depth.
- Cross-walk table: `ControlMapping` linking two controls from different frameworks with a mapping strength (direct equivalent, partial).
- Scoring engine: runs SQL aggregate on evidence status and control mappings to compute readiness score.

## AI Advisor (Phase 7)
- Powered by a LLM (OpenAI API, or self-hosted) with Retrieval-Augmented Generation (RAG).
- Embedding store (pgvector) for org documents and control descriptions.
- Chat completion endpoint with message history and chain-of-thought guardrails to ensure answers stay in compliance domain.
- Data privacy: no training on customer data; embeddings per org, not shared.

## Enterprise & White-Label (Phase 8)
- SSO: SAML via `@node-saml/node-saml`, OIDC via `openid-client`.
- SCIM: server implementation for Azure/Okta provisioning.
- Audit log: append-only `AuditEvent` table, async writer to not block requests.
- White-label: dynamic CSS variables and logo URL stored in `OrganizationSettings`, served by a tenant-aware SSR middleware.
- MSSP dashboard: special `organizationGroup` allows cross-org aggregated views with strict RLS bypass only for authorized admin roles.

## Performance & Scalability
- All API endpoints p95 < 200ms, AI advisor < 5s streaming.
- Database indexing: composite indexes on `(organization_id, created_at)` for all large tables.
- Rate limiting per org using token bucket.
- File uploads to S3 with pre-signed URLs.

## Testing Strategy
- Full integration tests for tenant isolation on every module.
- Contract tests for each connector.
- Chaos testing for queue failures and idempotency.