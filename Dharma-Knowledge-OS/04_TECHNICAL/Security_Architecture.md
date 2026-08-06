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

## Session revocation and the identity re-read

Auth is a JWT session (`strategy: "jwt"`, `maxAge: 30 days`). NextAuth's `jwt`
callback populates `role`/`organizationId` only when `user` is present — i.e.
only at sign-in — so for a long time the token was an **unrevokable bearer
credential**: deactivating a member (`organization.removeMember`) or
SCIM-deprovisioning them set `isActive: false` but did not end their open
session, and a role demotion left the old privilege in force until the token
expired. Only the 6 routers using `permissionProcedure` were protected, because
that middleware re-read the user row.

Since WAVE 5.1, `orgProcedure` itself re-reads the caller's `User` row on every
request (`src/server/lib/sessionIdentity.ts`) and **overwrites the session's
`role`/`organizationId` with the database's values** before any downstream
procedure sees them. The JWT is now treated as carrying only an unverified
`sub`. This applies to all org routers, so `managerProcedure`/`adminProcedure`
became revocation-aware without individual changes. A deactivated user gets
`FORBIDDEN`, a deleted user `UNAUTHORIZED`, and a token naming an org the user
has left `FORBIDDEN`.

**Staleness window: 30 seconds.** The row is cached in Redis
(`IDENTITY_CACHE_TTL_SECONDS`) because this read runs on every authenticated
request across 3–10 app replicas. Two mechanisms bound staleness:

1. **The TTL is the guarantee.** Any change to a `User` row takes effect
   everywhere within 30s, including changes made out of band (a DBA, a restored
   backup, a future code path).
2. **Eager invalidation is an optimization**, applied by a Prisma middleware on
   `User` writes (`src/server/db.ts`), which collapses the window to ~0 for
   writes that go through the app. It is deliberately *not* the correctness
   mechanism — there are ~14 `user.update`/`updateMany` call sites (7 in SCIM
   alone), and a scheme depending on each author remembering to invalidate
   fails silently the first time someone adds another.

`SessionIdentity` deliberately caches **only `User` scalars, never the joined
`CustomRole.permissions` map**. Editing a custom role is not a `User` write, so
a cached copy would go stale for up to the TTL and break the Phase 8 guarantee
that permission changes take effect immediately; `requirePermission` therefore
reads the `CustomRole` fresh off the cached `customRoleId`.

If Redis is unreachable the resolver falls through to a direct database read
rather than failing the request — failing closed would turn a Redis blip into a
total authentication outage, while falling through preserves the security
property exactly and costs only the cache benefit.

Note this also removes the strongest objection to the multi-replica production
topology, though **not** the rate-limiter one below, which is unrelated and
still open.

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
