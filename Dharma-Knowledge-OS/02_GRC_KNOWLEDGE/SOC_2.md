---
title: SOC 2
folder: 02_GRC_KNOWLEDGE
tags: [dharma, grc, soc2, framework]
source_docs: [1_PRD.md, 5_BACKEND_SCHEMA.md]
last_updated: 2026-07-23
status: reviewed
---

# SOC 2

SOC 2 (Type I or Type II) is an AICPA auditing standard evaluating a service organization's controls against five Trust Services Criteria: Security, Availability, Processing Integrity, Confidentiality, and Privacy. Type II additionally tests operating effectiveness over a period (commonly 3–12 months), not just design at a point in time — this is why continuous evidence collection (not a one-time snapshot) matters, and why Dharma's evidence lifecycle (`pending` → `verified` → `rejected`/`expired`) exists.

Common Criteria (CC series, e.g. CC6.1 = logical access controls) form the mandatory baseline; the other four criteria beyond Security are elective depending on what the org wants attested.

## In Dharma

- Tracked as a `Framework` row (name: "SOC 2 Type II"), controls scoped by domain (e.g. CC6.1 under "Logical Access").
- Cross-walked to ISO 27001 via `ControlMapping` — **SOC2 CC6.1 ↔ ISO27001 A.9.2.1** — so one piece of evidence (e.g. an MFA config screenshot) can satisfy the equivalent control in both frameworks without duplicate uploads. See [[Database_Design]].
- Evidence-to-control mapping is AI-assisted via pgvector cosine similarity against control descriptions (top-3 suggestions, user accepts/rejects). See [[User_Journeys]] Journey 2.
- The evidence lifecycle's continuous nature (Type II requiring effectiveness over time) is why `Evidence.expiresAt` exists — stale evidence should re-trigger collection.

Related: [[ISO_27001]] (cross-walk), [[Audit_Process]], [[Database_Design]].
