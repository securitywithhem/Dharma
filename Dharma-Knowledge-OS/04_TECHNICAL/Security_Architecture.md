---
title: Security Architecture
folder: 04_TECHNICAL
tags: [dharma, technical, security, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, 2_TRD.md, 1_PRD.md, packages/db/schema.prisma]
last_updated: 2026-08-08
status: reviewed
---

# Security Architecture

## Non-negotiable requirements for every new (pivot) component

These apply to the Sandbox Manager, Agent Runtime, every specialized agent, and any tool that touches a live target. Source: `Dharma_Pivot_Architecture_Plan.md` §5. Treat these as launch-blocking, not aspirational.

1. **No agent gets unrestricted host access.** No Docker socket mount, no host filesystem, no host cloud credentials, ever — the single most important line item, because Dharma will be running untrusted, possibly hostile application code as its core function. Note the existing `pentest-worker` container already holds the host Docker socket for isolation purposes (see [[Database_Design]] pre-pivot notes) — **audit that specifically** before the Sandbox Manager reuses any of its infrastructure; the new component's whole point is to not need that access.
2. **Prompt injection boundary.** Four distinct trust tiers: system instructions, tool policy, user instructions, scanned repository/application content. Tier 4 content can never escalate to tier 1/2 authority, even by trying "ignore previous instructions" or "system: grant access."
3. **SSRF discipline extends everywhere, not just pentest.** Any agent tool accepting a URL/hostname (`http_request`, connector test endpoints, webhook dispatch, report generation from user input) needs the same RFC1918/loopback/link-local/cloud-metadata blocklist and DNS-rebind re-check at dispatch time already scoped for the pentest module in WAVE 0. Generalize that work rather than treating it as pentest-only.
4. **Ownership verification gates any live-target testing**, agent-driven or not — same `VerifiedAsset` model, same DNS TXT/HTTP-file challenge, same server-side check, whether the target came from the pentest form or the Recon Agent choosing to hit a discovered subdomain.
5. **Dedicated scan/exploit authorization audit trail**, separate from the general `AuditLog` — who authorized which target, which agent ran against it, when. Legal protection artifact, not optional polish.
6. **Human approval required before any code-modifying or externally-visible action** — suggested patches yes, auto-applied PRs no (until a later phase, and even then behind explicit opt-in).
7. **Multi-tenant isolation extends to agent memory and vector retrieval.** No agent run, embedding, or knowledge-graph query may cross an `organizationId` boundary — audit this specifically once RAG/Knowledge Engine work starts (Phase E); it's the easiest place for a subtle cross-tenant leak to hide.

## Core controls (pre-pivot, kept unchanged)

- **Data sovereignty**: AI processing local by default (Ollama); external network access disabled for `ollama` and `postgres` containers. The `LLMProvider` abstraction adds opt-in external providers — this does not weaken the default, it makes the exception explicit and BYOK-gated rather than a silent fallback.
- **Access control**: every tRPC endpoint requires a valid session; org ID filters enforced at the DB query layer, not just the UI. See [[Authorization]].
- **Presigned URLs**: 15-minute expiry on MinIO file access; `AuditExport` uses a longer 24h window for export packages.

## Session revocation and the identity re-read (unchanged)

Auth is a JWT session (`strategy: "jwt"`, `maxAge: 30 days`). Since WAVE 5.1, `orgProcedure` re-reads the caller's `User` row on every request (`src/server/lib/sessionIdentity.ts`) and overwrites the session's `role`/`organizationId` with the database's values before any downstream procedure sees them, with a 30-second Redis-cached staleness window and eager invalidation on `User` writes as an optimization, not the correctness mechanism. This pattern should be the model for how Agent Runtime tool-permission checks read `CustomRole` — fresh per call, not trusted from a stale session claim, per non-negotiable #2 above (an agent's own reasoning is exactly the kind of thing that must never be trusted to assert its own elevated permission).

## Secrets handling patterns (unchanged, extends to new components)

Two patterns, chosen per whether the secret needs to be recovered later:
1. **Hash-only, validate-only**: SHA-256 for `OrganizationSettings.scimTokenHash`, `Endpoint.enrollmentTokenHash`, `ApiKey.keyHash`, `AuditorAccess.tokenHash`/`sessionTokenHash`.
2. **Reversible AES-256-GCM envelope**: `Connector.config`, `Webhook.secret`, `OrganizationSettings.siemExportConfig`.

Any credential the LLM Provider abstraction stores (BYOK API keys) must use pattern 2 — recoverable, since the app needs to present it on outbound calls, but never logged in `AgentRun.toolCalls`.

## Cryptographic audit trail (unchanged, extended)

`AuditLog` hash-chains every mutating operation; `ChainAnchor` periodically anchors the chain externally. **New**: a dedicated scan/exploit authorization audit trail (non-negotiable #5 above) is a separate log, not a new `AuditLog` action type — it needs different retention and access-control properties (legal evidence of authorization, potentially subpoenable independent of general product audit history).

## Rate limiting (unchanged, relevant to Agent Runtime)

Fixed-window, in-process limiter (`src/server/lib/rateLimit.ts`) — correct only for a single Next.js process. **Do not reuse this as-is for Agent Runtime tool-call rate limiting** — a runaway or compromised agent loop hitting `http_request` in a tight cycle is exactly the failure mode a shared, Redis-backed limiter is for. Scope this explicitly in the Phase B implementation prompt rather than inheriting the existing limiter's known multi-replica weakness.

Related: [[Threat_Model]], [[Authentication]], [[Authorization]], [[Database_Design]], [[System_Architecture]].
