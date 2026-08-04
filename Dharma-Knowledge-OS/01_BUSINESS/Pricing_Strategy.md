---
title: Pricing Strategy
folder: 01_BUSINESS
tags: [dharma, business, pricing]
source_docs: [1_PRD.md, packages/db/seed-plans.ts]
last_updated: 2026-08-04
status: draft
---

# Pricing Strategy

No founder-authored pricing strategy exists in the source docs. The only concrete signals:

- PRD frames Dharma against incumbents charging **$10k–$50k+/year**, implying a materially lower price point as the core wedge.
- README references subscription tiers — **Free, Pro, Enterprise** (`Plan` model in the live schema), confirming tiered SaaS billing is built. Billing runs behind a provider-agnostic interface; **Razorpay is the live provider** and Stripe is retained for international sale, because Stripe is invite-only for India-based accounts. See [[Billing_And_Payments]] and [[Database_Design]].
- `packages/db/seed-plans.ts` seeds **defaults of 99 (Pro) and 999 (Enterprise)**, in a currency read from `BILLING_CURRENCY` (default `USD`), overridable via `BILLING_PRICE_PRO`/`BILLING_PRICE_ENTERPRISE`. These are placeholder seed values, not an owner-set price list — see Open Questions. Feature gating rules do exist in code (`Plan.limits`/`Plan.features` read by `src/server/services/entitlement.ts`) but are not documented as a pricing decision anywhere.

## Open Questions

- Actual price points per tier: still an owner decision. The seed defaults above are code placeholders and should not be read as a pricing strategy — and now that Razorpay India sells in INR, whether 99/999 are USD or INR figures materially changes the positioning. **Needs an owner call.**
- Entitlement/feature-gating rules per tier: enforced in code (`src/server/middleware/entitlement.ts`, `src/server/services/entitlement.ts`) but never ratified as a commercial decision — which limits belong to which tier is undocumented.
- MSSP pricing model (per-client-org billing?): undocumented.
