---
title: Coding Standards
folder: 05_DEVELOPMENT
tags: [dharma, development, standards]
source_docs: [2_TRD.md, packages/db/schema.prisma]
last_updated: 2026-07-23
status: reviewed
---

# Coding Standards

Extracted from TRD architecture notes and patterns consistently visible across the live schema (the schema's own inline comments are unusually explicit about conventions — worth treating as a de facto style guide):

1. **Adapter pattern for connectors** — each `ConnectorType` (AWS/AZURE/GCP/GITHUB/OKTA/JIRA/VERCEL) implements a shared typed interface rather than type-specific branching scattered through the codebase.
2. **Typed, end-to-end interfaces** — tRPC + Prisma generated types flow client-to-server with no manual API contract duplication.
3. **BullMQ for anything slow** — AI inference, file parsing, PDF generation, hash chaining are never done in a request thread. See [[System_Architecture]].
4. **Consistent secret-storage convention** — hash-only (SHA-256) for validate-only tokens, AES-256-GCM envelope for recoverable secrets, applied identically across `AuditorAccess`, `Endpoint`, `ApiKey`, `OrganizationSettings`, `Connector`, `Webhook`. See [[Security_Architecture]].
5. **`onDelete: Cascade` on tenant relations** — repo-wide convention (explicitly called out as one the Phase 9 Endpoint task brief omitted and had to be added to match).
6. **Deviations are documented inline** — where an implementation departs from `5_BACKEND_SCHEMA.md` or a task brief, the schema carries a comment explaining why (e.g. `MsspGrant`'s explicit allow-list instead of a role bypass). Follow this pattern: document *why* a deviation was made, not just that it was.
7. **Suggestion-only AI outputs are never auto-applied** — `Evidence.suggestedControlIds`, `ControlMapping.suggestedByAI` both require explicit user accept/reject, preserving audit-log integrity.

Related: [[Development_Status]], [[Database_Design]], [[Security_Architecture]].
