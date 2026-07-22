---
title: Risk Management
folder: 02_GRC_KNOWLEDGE
tags: [dharma, grc, risk]
source_docs: [5_BACKEND_SCHEMA.md]
last_updated: 2026-07-23
status: reviewed
---

# Risk Management

Standard GRC risk management: identify assets and threats, assess likelihood × impact, treat (mitigate/transfer/accept/avoid), and track residual risk over time.

## In Dharma

Risk surfaces in two concrete places in the live schema (beyond the original PRD scope):

- **`ReadinessScore`** and **`Recommendation`** models — the "compliance readiness score / gap heatmap" described in PRD Feature 5 is effectively a risk posture summary: it aggregates control status into a 0–100% score and surfaces domains lacking evidence as gaps.
- **`Vulnerability`** and **`Asset`** models (from the pentest module) — a more literal technical-risk register, tracking discovered vulnerabilities per scanned asset with presumably a severity/CVSS dimension (per TRD's "CVSS calculator" API note). See [[Threat_Model]] for the security-specific risk lens.

There is no dedicated organizational risk register (e.g. "risk of vendor X going down") documented — Dharma's risk handling is compliance-control-centric and technical-vulnerability-centric, not enterprise-risk-management-centric.

Related: [[Audit_Process]], [[Database_Design]], [[Threat_Model]].
