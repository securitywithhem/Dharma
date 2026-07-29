---
title: Decisions
folder: 99_AI_MEMORY
tags: [dharma, ai-memory, decisions]
source_docs: []
last_updated: 2026-07-23
status: stable
---

# Decisions

| Date | Decision |
|---|---|
| 2026-07-23 | Vault content mapped to the docs that actually exist in this repo, not invented to fit the original bootstrap template's assumed `1_PRD.md` root-level layout and Phase-0-starting-point — see [[Dharma_Master_Context]] for the full doc-vs-code gap analysis. |
| 2026-07-23 | New vault created at `Dharma-Knowledge-OS/` rather than merged into the existing `obsidian-vaults/Dharma-Project/`, to keep raw source docs separate from synthesized/cross-linked notes. |
| 2026-07-27 | Kept the implemented indigo/haldi "Indian pigment" palette; declined a proposed dark-first jade/brass rework. The proposal's stated basis was that `UI:UX.md` "already specifies dark theme, green/blue accents" — that line actually reads "**assume** dark theme", a placeholder, not a specification. Adopted the proposal's genuinely missing parts instead (severity scale, `StatusBadge`, `DharmaRing`, `resetTheme`). See [[Design_System]]. |
| 2026-07-27 | Severity gets its own 5-step token ramp keyed to the Prisma `Severity` enum, separate from the `--success`/`--warning`/`--critical` status tokens: status is a control's state, severity is a finding's blast radius, and both render side by side. Hue held constant across light/dark so auditors don't relearn the ramp in exported reports. |
| 2026-07-27 | `whiteLabel.resetTheme` preserves `customDomain` and its verification. Resetting a theme is a styling action; clearing the domain would take the tenant's URL offline and need a fresh CNAME round-trip to undo. |

See [[Decisions]] in `05_DEVELOPMENT` for the code-facing mirror of this log.
