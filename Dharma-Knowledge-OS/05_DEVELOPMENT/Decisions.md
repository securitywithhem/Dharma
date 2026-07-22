---
title: Decisions
folder: 05_DEVELOPMENT
tags: [dharma, development, decisions]
source_docs: []
last_updated: 2026-07-23
status: stable
---

# Decisions

Append-only log of architecturally significant decisions and their rationale. Not backfilled with invented history — populated going forward.

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-23 | New `Dharma-Knowledge-OS/` vault created alongside the existing `obsidian-vaults/Dharma-Project/` rather than merged into it | Keep raw source docs (PRD/TRD/etc.) separate from the synthesized, cross-linked knowledge base derived from them — see [[Dharma_Master_Context]] |

Many real architectural decisions already exist as inline comments in `packages/db/schema.prisma` (e.g. MSSP grant design, SCIM token hashing) — see [[Database_Design]], [[Coding_Standards]] for the ones surfaced during this bootstrap. Future entries here should capture decisions as they're made, not retroactively mine the schema.

Related: [[Progress_Log]], [[Coding_Standards]].
