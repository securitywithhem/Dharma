---
title: Authorization
folder: 04_TECHNICAL
tags: [dharma, technical, authorization, rbac, tenancy, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, 1_PRD.md, packages/db/schema.prisma]
last_updated: 2026-08-08
status: reviewed
---

# Authorization

## Tenant isolation (unchanged)

Every business row carries `organizationId`; tRPC procedures filter by the session's org context, not a client-supplied ID. **Extends to the pivot's new models**: `Finding`, `AgentRun`, `Risk` all carry `organizationId` and must be filtered identically — see [[Database_Design]]. This extension is explicit and non-negotiable per [[Security_Architecture]] item 7: no agent run, embedding, or knowledge-graph query may cross an `organizationId` boundary.

## Role model (unchanged)

**Legacy (PRD-era)**: `Role` enum — `ADMIN`, `COMPLIANCE_MANAGER`, `VIEWER`, `PUBLISHER`.

**`CustomRole`**: org-defined, permissions-as-JSON, validated against a `PERMISSION_KEYS` allowlist. `User.customRoleId` nullable, falls back to the legacy enum.

## New: Agent tool permission scopes (Phase B/F)

The Agent Runtime's Policy Engine is a **second, orthogonal authorization layer** — not a replacement for `CustomRole`, a consumer of it. Every tool call an agent makes passes through:

```
LLM tool_use request → Policy Engine
  → permission check (role, scope, rate limit)
  → sandboxed tool execution
  → mandatory audit-log write
```

Design requirements:
- **Add agent-tool permission keys to `PERMISSION_KEYS`**, additive to the existing allowlist (e.g. `agents.recon.run`, `agents.exploit.run`, `agents.findings.approve`, `agents.patches.approve`) — do not invent a parallel permission system.
- **A tool call's permission check must read `CustomRole` fresh**, the same way `orgProcedure`'s session-identity re-read does for human requests (see [[Security_Architecture]]) — an agent's own LLM reasoning must never be trusted to assert its own elevated permission; the check happens at the Policy Engine, deterministically, not inside the agent's prompt.
- **Human approval is a distinct permission from "agent may run"** — `agents.exploit.run` lets an agent attempt an exploit inside the sandbox; it does not imply `agents.patches.approve` or any ability to auto-apply a code change or open a PR. See [[Security_Architecture]] non-negotiable #6.
- **Scan/exploit authorization is logged separately** from the general `CustomRole` permission check — see the dedicated audit trail in [[Security_Architecture]] item 5. A permission check answers "is this agent allowed to try"; the authorization log answers "who authorized this specific target, when."

## Cross-tenant access (MSSP) — unchanged, one deliberate exception

`MsspGrant` is the only sanctioned way to read across org boundaries: explicit allow-list (`scopeOrgIds`), optional time-boxing, explicit revocation, single consumer in code. This pattern is the template the Agent Runtime's tool-permission design above follows: **narrow, explicit, revocable, auditable** — never a role-name bypass. White-label/MSSP dashboard investment is parked per [[Roadmap]], but the underlying isolation pattern stays the reference design.

Related: [[Authentication]], [[Database_Design]], [[Security_Architecture]], [[Threat_Model]], [[System_Architecture]].
