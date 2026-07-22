---
title: Pricing Strategy
folder: 01_BUSINESS
tags: [dharma, business, pricing]
source_docs: [1_PRD.md]
last_updated: 2026-07-23
status: draft
---

# Pricing Strategy

No founder-authored pricing strategy exists in the source docs. The only concrete signals:

- PRD frames Dharma against incumbents charging **$10k–$50k+/year**, implying a materially lower price point as the core wedge.
- README references subscription tiers — **Free, Pro, Enterprise** — integrated with Stripe (`Plan` model in the live schema), confirming tiered SaaS billing is built, but no actual price points, feature gating rules, or entitlement logic are documented outside code. See [[Database_Design]] for the `Plan` model.

## Open Questions

- Actual price points per tier: unknown, not in any doc.
- Entitlement/feature-gating rules per tier: would need to be read from code (`OrganizationSettings`, billing middleware), not sourced here per this vault's business/technical split.
- MSSP pricing model (per-client-org billing?): undocumented.
