---
title: Authorization
folder: 04_TECHNICAL
tags: [dharma, technical, authorization, rbac, tenancy]
source_docs: [1_PRD.md, packages/db/schema.prisma]
last_updated: 2026-07-23
status: reviewed
---

# Authorization

## Tenant isolation

Every business row carries `organizationId`; tRPC procedures filter by the session's org context, not a client-supplied ID — the TRD's "Access Control" security control. See [[Product_Principles]] principle 1.

## Role model

**Legacy (PRD-era)**: `Role` enum — `ADMIN`, `COMPLIANCE_MANAGER`, `VIEWER`, plus `PUBLISHER` (added for marketplace authorship, not in the original PRD's 3-role list).

**Phase 8 RBAC**: `CustomRole` — org-defined, permissions-as-JSON (`{ "controls.read": true, ... }`, validated against a `PERMISSION_KEYS` allowlist). `User.customRoleId` is nullable: when null, permission checks fall back to the legacy `Role` enum mapping, giving a zero-downtime migration path from enum-based to custom RBAC. `CustomRole.isDefault` seeds protected copies of the legacy defaults.

## Cross-tenant access (MSSP) — the one deliberate exception

`MsspGrant` is the **only** sanctioned way to read across org boundaries. Rather than "role == MSSP admin ⇒ bypass tenant isolation everywhere," it requires:
- An explicit allow-list (`scopeOrgIds`) — adding an org to a group later never silently widens an existing grant.
- Optional time-boxing (`expiresAt`) and explicit revocation (`revokedAt`, blocks immediately).
- A single consumer in code (`src/server/services/mssp/aggregateQuery.service.ts`), keeping blast radius auditable.

This is exactly the kind of narrow, revocable exception a security review would demand before shipping any cross-tenant read path — see [[Threat_Model]].

Related: [[Authentication]], [[Database_Design]], [[Security_Architecture]].
