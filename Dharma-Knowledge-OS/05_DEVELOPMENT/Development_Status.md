---
title: Development Status
folder: 05_DEVELOPMENT
tags: [dharma, development, status]
source_docs: [6_IMPLEMENTATION_PLAN.md, "Future Scope Implementationplan (absorbed 2026-07-23, source vault since deleted)", packages/db/schema.prisma, CLAUDE.md]
last_updated: 2026-07-23
status: reviewed
---

# Development Status

As of 2026-07-23:

- **Phase 0 (Core Foundation)**: complete. Confirmed by live schema — `Organization`, `User`, `Framework`, `Control`, `Evidence`, `Policy`, `AuditLog` all present with the shape described in the Week 1–4 plan.
- **Phase 1 (Local AI Integration)**: complete. `vector(384)` embeddings on `Evidence`/`RegulationSnippet`, confirming Ollama-based RAG is live, not just planned.
- **Phase 2 and beyond**: the schema's own inline phase comments (`// Phase 2 Feature 2: Automated Evidence Connectors`, `// Phase 8 Part 1 — Enterprise SSO / SCIM / RBAC`, etc.) show continuous build-out through at least "Phase 9 Part 3," matching the separately-planned "Future Scope" roadmap (Phase 3b–9) almost model-for-model — see [[Roadmap]] for the full phase timeline and [[Feature_Backlog]] for the model-by-phase mapping.
- This project's `CLAUDE.md` directs all code exploration through a `code-review-graph` MCP knowledge graph rather than raw file search — a sign of an actively maintained, tooled-up codebase, not an early-stage MVP.
- Notably, **Phase 5 (Pentest) has real, dated implementation notes** (Parts 1 and 2, migrations `20260711143208_phase5_pentest_vulnerability_models` and `20260711152443_phase5_part2_vuln_enrichment`) documenting deviations from the original Future Scope spec as they were built — e.g. a dedicated `pentest-worker` container for Docker-socket isolation, and CVSS scoring via `ae-cvss-calculator`. Part 3 (vulnerability management UI, ZAP/Burp import) was explicitly deferred and its status is unconfirmed here.

## Resolved: the Phase 3–9 roadmap does have a source doc

An earlier version of this vault noted no single doc covered Phase 3–9. That was wrong — a distinct "Dharma Future Scope" document set (PRD/TRD/App Flow/Backend Schema/UI-UX/Implementation Plan) covered exactly that, just under unnumbered filenames in `obsidian-vaults/Dharma-Project/`, which has since been absorbed into this vault and deleted (recoverable via git history). See [[Roadmap]] for the full timeline this correction is based on.

## Still open

No source doc confirms Phase 5 Part 3 (vuln management UI) or Phase 9's later status — that would need direct code inspection (e.g. via `query_graph`/`get_architecture_overview`) rather than a planning doc, since neither doc set nor the schema comments confirm completion of every part.

Related: [[Roadmap]], [[Feature_Backlog]], [[Progress_Log]].
