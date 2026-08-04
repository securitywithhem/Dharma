---
title: Security Architecture
folder: 04_TECHNICAL
tags: [dharma, technical, security]
source_docs: [2_TRD.md, 1_PRD.md, packages/db/schema.prisma]
last_updated: 2026-08-04
status: reviewed
---

# Security Architecture

## Core controls (TRD Section 7)

- **Data sovereignty**: all AI processing local (Ollama); external network access disabled for `ollama` and `postgres` containers.
- **Access control**: every tRPC endpoint requires a valid session; org ID filters enforced at the DB query layer, not just the UI. See [[Authorization]].
- **Presigned URLs**: 15-minute expiry on MinIO file access (TRD) — `AuditExport` uses a longer 24h window for export packages, a deliberate exception for a different use case (download-and-review vs. direct upload/access).

## Secrets handling patterns (consistent across the schema)

Two distinct patterns, chosen per whether the secret needs to be recovered later:
1. **Hash-only, validate-only** (never recoverable): `OrganizationSettings.scimTokenHash`, `Endpoint.enrollmentTokenHash`, `ApiKey.keyHash`, `AuditorAccess.tokenHash`/`sessionTokenHash` — all SHA-256. Plaintext is shown exactly once at creation.
2. **Reversible AES-256-GCM envelope** (needed for outbound calls): `Connector.config`, `Webhook.secret`, `OrganizationSettings.siemExportConfig` — encrypted via dedicated vault modules (`connectorVault.ts`, `secretVault.ts`, `siemVault.ts`).

## Cryptographic audit trail

`AuditLog` hash-chains every mutating operation (SHA-256 of the row's fields concatenated with the previous row's hash). `ChainAnchor` periodically anchors the chain externally (with optional OpenTimestamps proof) so integrity doesn't rely solely on the database being untampered — a defense specifically against Problem Statement item 5 (a rogue DB admin altering logs). See [[Audit_Process]].

## Rate limiting

The TRD called for a token bucket. What is built (`src/server/lib/rateLimit.ts`) is a **fixed-window, in-process** limiter: a module-level `Map` of `{ count, windowStart }`, throwing `TRPCError("TOO_MANY_REQUESTS")`, called at the top of a procedure keyed on something like `${organizationId}:${procedureName}`. Thresholds are passed per call site rather than defined centrally.

Its own comment states the constraint honestly: this is correct only while Dharma runs one Next.js process per deployment. **Multiple replicas behind a load balancer would multiply every limit by the replica count** — that migration to a Redis-backed counter is not done. Relevant to [[Deployment]]'s Kubernetes question, since a replicated deploy silently weakens this control.

Related: [[Threat_Model]], [[Authentication]], [[Authorization]], [[Database_Design]].
