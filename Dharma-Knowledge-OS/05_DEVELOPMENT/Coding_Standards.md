---
title: Coding Standards
folder: 05_DEVELOPMENT
tags: [dharma, development, standards, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, 2_TRD.md, packages/db/schema.prisma]
last_updated: 2026-08-08
status: reviewed
---

# Coding Standards

Extracted from TRD architecture notes and patterns consistently visible across the live schema (the schema's own inline comments are unusually explicit about conventions — worth treating as a de facto style guide), plus new conventions introduced by the pivot.

1. **Adapter pattern for connectors** — connectors implement a shared typed interface (`src/server/connectors/types.ts`) rather than type-specific branching scattered through the codebase, dispatched through `connectorRegistry` in `src/server/connectors/registry.ts`. The registry is keyed by the full `ConnectorType` enum and maps unimplemented types to `null`, so an unbuilt connector fails with an explicit error rather than silently. Live adapters: AWS, GitHub, Okta, Jira. `AZURE`/`GCP` are `null` placeholders; `VERCEL` has a legacy Phase 2 sync (`src/workers/connectors/vercel.ts`) not yet on this interface. The same provider-adapter shape is used for payments — see [[Billing_And_Payments]] — **and is now the required shape for the pivot's `LLMProvider` interface** (§3.8 of the pivot plan): one typed interface, per-provider implementations (Ollama/OpenAI/Anthropic), dispatched through a registry, unbuilt providers fail explicitly rather than silently falling back.
2. **Typed, end-to-end interfaces** — tRPC + Prisma generated types flow client-to-server with no manual API contract duplication.
3. **BullMQ for anything slow** — AI inference, file parsing, PDF generation, hash chaining are never done in a request thread. See [[System_Architecture]]. **Extends to the pivot's Agent Runtime**: any tool call with unpredictable latency (agent LLM reasoning steps, sandboxed scan execution) goes through BullMQ, not a synchronous tRPC mutation — the request/response for "start a scan" should return a job/`AgentRun` id immediately, not block on the scan finishing.
4. **Consistent secret-storage convention** — hash-only (SHA-256) for validate-only tokens, AES-256-GCM envelope for recoverable secrets, applied identically across `AuditorAccess`, `Endpoint`, `ApiKey`, `OrganizationSettings`, `Connector`, `Webhook`, and now BYOK `LLMProvider` credentials. See [[Security_Architecture]].
5. **`onDelete: Cascade` on tenant relations** — repo-wide convention; applies to `Finding`, `AgentRun`, and `Risk` as they're added.
6. **Deviations are documented inline** — where an implementation departs from a spec or task brief, the schema/code carries a comment explaining why (e.g. `MsspGrant`'s explicit allow-list instead of a role bypass, or the `Asset` model reconciliation flagged in [[Database_Design]] before it's resolved). Follow this pattern: document *why* a deviation was made, not just that it was.
7. **Suggestion-only AI outputs are never auto-applied** — `Evidence.suggestedControlIds`, `ControlMapping.suggestedByAI` both require explicit user accept/reject, preserving audit-log integrity. **The pivot extends this as a hard security requirement, not just a UX convention**: agent-suggested patches require human approval before any code-modifying or externally-visible action — no exceptions, no auto-PR, until an explicit later phase with opt-in. See [[Security_Architecture]] non-negotiable #6.
8. **Every URL-accepting tool gets the SSRF blocklist, not just the ones that look network-y.** New with the pivot: this applies uniformly to `http_request`-style Agent Runtime tools, connector test endpoints, webhook dispatch, and report generation from user input — generalized from the pentest-only scope it started in. See [[Security_Architecture]] non-negotiable #3.

Related: [[Development_Status]], [[Database_Design]], [[Security_Architecture]], [[System_Architecture]].
