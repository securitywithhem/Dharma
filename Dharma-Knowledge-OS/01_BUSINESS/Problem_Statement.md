---
title: Problem Statement
folder: 01_BUSINESS
tags: [dharma, business, problem]
source_docs: [1_PRD.md]
last_updated: 2026-07-23
status: reviewed
---

# Problem Statement

From PRD Section 2:

1. **DPDP Act 2023 penalties** — up to ₹250 Crores for data breaches, forcing Indian companies to rapidly build consent frameworks and data-processing records.
2. **Data sovereignty risk** — existing SaaS compliance tools require uploading sensitive artifacts (network diagrams, employee handbooks, DB logs, firewall configs) to external cloud AI, violating privacy policy for security-conscious orgs.
3. **High cost** — commercial SaaS compliance platforms run $10k–$50k+/yr, prohibitive for Indian MSMEs and early-stage startups.
4. **Manual evidence collection bottleneck** — teams burn hundreds of hours manually collecting and matching screenshots/PDFs/logs to control requirements.
5. **Audit log vulnerability** — standard relational-DB audit trails can be altered by a rogue admin or attacker, undermining audit integrity.

See [[Security_Architecture]] for how Dharma addresses (5), and [[Database_Design]] / [[System_Architecture]] for how local AI addresses (2).

## Open Questions

- No validated market sizing beyond the PRD's "1M+ registered MSMEs" claim — this is asserted, not sourced.
- No documented competitive win/loss data.

`status: draft` on this note's siblings in this folder reflects that business/market data beyond the PRD's problem framing does not exist in the source docs — see [[Target_Customers]], [[Competitor_Analysis]], [[Pricing_Strategy]], [[Business_Model]].
