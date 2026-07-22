---
title: Business Model
folder: 01_BUSINESS
tags: [dharma, business, model]
source_docs: [1_PRD.md, README.md]
last_updated: 2026-07-23
status: draft
---

# Business Model

Inferred, not documented: Dharma appears to run a **self-hosted, open-source core with a tiered SaaS/hosted layer** (Free/Pro/Enterprise via Stripe, per README and the `Plan` model — see [[Database_Design]]), plus a **marketplace** (`MarketplaceItem`) that may carry its own monetization (publishing/import fees, revenue share) — undocumented.

The **MSSP** capability (`MsspGrant`) suggests a possible partner/reseller channel model (MSSPs managing multiple client orgs under one relationship), but there is no documented go-to-market or channel strategy.

## Open Questions

- Is the self-hosted deployment path free forever (open-core), or gated behind Enterprise?
- Marketplace monetization model: unknown.
- MSSP commercial terms (per-seat, per-client-org, revenue share): unknown.

This note should be revisited with direct founder input — see [[Pricing_Strategy]] for the related gap.
