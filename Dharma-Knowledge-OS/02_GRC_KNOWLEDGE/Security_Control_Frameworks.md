---
title: Security Control Frameworks
folder: 02_GRC_KNOWLEDGE
tags: [dharma, grc, frameworks, control-mapping]
source_docs: [5_BACKEND_SCHEMA.md]
last_updated: 2026-07-23
status: reviewed
---

# Security Control Frameworks

A "control framework" is a catalog of specific, checkable requirements (controls) organized by domain, that an org can be assessed against. Dharma treats frameworks as first-class, versioned, importable data rather than hardcoded logic.

## How Dharma models this

- **`Framework`** → **`Control`** (one-to-many, `domain`-scoped) → **`Evidence`** (many-to-many via mapping). See [[Database_Design]].
- **`FrameworkVersion`** — frameworks aren't static; this model supports versioning as standards update (e.g. ISO 27001:2013 → :2022).
- **`ControlMapping`** — the cross-walk table enabling one piece of evidence to satisfy equivalent controls across frameworks (the SOC2 CC6.1 ↔ ISO27001 A.9.2.1 example — see [[SOC_2]] and [[ISO_27001]]).
- **`MarketplaceItem`** / **`ImportedItem`** — frameworks and controls can be published/discovered/imported via the marketplace rather than only seeded via migration, per PRD's later-scope marketplace feature (now built — see [[Dharma_Master_Context]]).
- **`RegulatoryAlert`** — tracks regulatory changes that might require control updates.

Related: [[ISO_27001]], [[SOC_2]], [[GDPR]], [[User_Journeys]] (Marketplace Import journey).
