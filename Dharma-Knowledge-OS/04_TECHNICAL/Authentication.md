---
title: Authentication
folder: 04_TECHNICAL
tags: [dharma, technical, auth, sso]
source_docs: [1_PRD.md, packages/db/schema.prisma]
last_updated: 2026-07-23
status: reviewed
---

# Authentication

## Original scope (PRD Feature 8)

NextAuth.js with Google OAuth and email magic links. `Account`/`Session`/`VerificationToken` models are the standard NextAuth-Prisma-adapter shape.

## Phase 8 additions — Enterprise SSO (confirmed via schema + package.json, not in PRD)

- **SAML** via `@node-saml/node-saml`; **OIDC** via `openid-client`.
- Config stored per-org in `OrganizationSettings.ssoConfig` (Json: `{ type: "SAML"|"OIDC", ... }`); secret members (e.g. OIDC client secret) are AES-256-GCM envelopes, never plaintext.
- `OrganizationSettings.ssoEnforced` — a queryable flag needed at login time to force SSO for an org (a deviation the schema comments flag as not present in the original `5_BACKEND_SCHEMA.md` sketch).

## SCIM provisioning

- `User.scimExternalId` — the IdP's external ID, unique **per org** (not globally, since two IdPs may reuse the same value).
- `User.isActive` — SCIM soft-delete: deactivated users keep their row (for `AuditLog` integrity) but can't sign in.
- `OrganizationSettings.scimTokenHash` — the SCIM bearer token is stored as a SHA-256 hash (validate-only), not reversibly encrypted — a deliberate, stricter deviation from the original spec.

## Auditor access (distinct from user auth)

Time-limited JWT via `AuditorAccess` (`tokenHash`/`sessionTokenHash`, both hashed, both unique). See [[Audit_Process]] and [[User_Journeys]] Journey 5.

## Endpoint agent enrollment (distinct again)

`Endpoint.enrollmentTokenHash` — same SHA-256-hash-not-plaintext pattern; the plaintext token is returned once at enrollment and never persisted.

Related: [[Authorization]], [[Database_Design]], [[Security_Architecture]].
