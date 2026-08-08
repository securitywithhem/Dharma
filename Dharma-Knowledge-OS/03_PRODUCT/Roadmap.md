---
title: Roadmap
folder: 03_PRODUCT
tags: [dharma, product, roadmap, phases, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md]
last_updated: 2026-08-08
status: reviewed
---

# Roadmap

**As of 2026-08-08, this roadmap is governed by `Dharma_Pivot_Architecture_Plan.md`.** The old Phase 3b–9 "Future Scope" roadmap (billing → marketplace → connectors → pentest → cross-walking → AI advisor → enterprise/white-label → MSSP) is now historical — it describes how the pre-pivot baseline was built, not what happens next. See [[Development_Status]] for exactly which of those phases are considered done, kept, extended, or discarded.

## Phase A — Finish what's already in flight (do not skip, do not reorder)

Source: the pre-pivot `dharma-master-remediation-prompt.md` WAVE 0 and WAVE 1 (status of that file unconfirmed in this vault — verify before assuming complete, see [[Development_Status]]).

- WAVE 0 (pentest ownership verification + SSRF blocklist + scan audit trail) — **now foundational**, not optional: the Sandbox Manager and Agent Runtime reuse this exact discipline for every network-facing tool.
- WAVE 1 (framework-detail crash, dead empty-state CTAs, SSO blank page, Ollama connectivity) — blocks real user testing regardless of the pivot.
- **Deviation, deliberate**: when WAVE 1's Ollama fix is reached, build the LLM Provider abstraction instead of a point fix — same ticket, larger payload, avoids redoing this for every future agent.

## Phase B — Foundation for the Security Engine

- Sandbox Manager, validated against one known-safe test app first.
- Agent Runtime + tool system + policy engine, audit logging wired from day one.
- `Finding` model migration (additive) + backfill script; `Vulnerability`/`PenTest` stay readable in parallel until cutover is proven.
- Benchmark harness skeleton, 2–3 intentionally vulnerable test apps (SQLi, IDOR) — this is the acceptance gate for Phase C; build it now.

## Phase C — First vertical slice (the actual pivot proof point)

- Recon → Code → Web/API → Exploit → Validator, scoped to SQL Injection and IDOR only.
- Every confirmed `Finding` writes `Evidence` and updates the linked `Control` status automatically — this is the moment the pivot becomes real and observable.
- Gate: run the full benchmark suite. Do not expand vulnerability classes until false-positive rate on the harness is acceptable (define a target, e.g. <10% FP on confirmed findings, before moving on).

## Phase D — Expand coverage + developer experience

- Auth Agent, Command Injection, Path Traversal, and remaining classes, one at a time, each gated by the same benchmark discipline.
- CLI + GitHub Action with PR comments — proof point for developer-first positioning.
- Suggested-patch generation (not auto-PR yet) on confirmed findings.

## Phase E — Compliance Engine wiring

- Asset & Data Inventory — infer DPDP/SOC2/ISO applicability instead of asking the user to self-assess.
- Knowledge Engine with versioned/provenance-tracked frameworks — ASVS, NIST CSF, SOC2, ISO27001, DPDP, in that priority order (DPDP-first positioning preserved).
- Rewire the Compliance Advisor onto the Knowledge Engine + LLM Provider abstraction — replaces the Ollama-only RAG rather than patching it a second time.
- Readiness scoring, not certification claims — enforce "readiness ≠ certification" everywhere in copy.

## Phase F — Risk Engine + GRC depth

- Risk model (`Risk`), risk register UI, exceptions with mandatory expiry.
- Reconcile the Roles-page/Team-membership drift while RBAC is touched for agent tool permissions anyway — same underlying fix, done once.

## Phase G — Trust surfaces (only after A–F are solid)

- Trust Center, security questionnaire automation, regulatory change monitoring.
- Intentionally last — this is the "prove it to a customer" layer and is worthless if the evidence underneath it isn't real yet.

## What's explicitly discarded or parked, not carried forward

- Marketplace **commerce** (paid frameworks, revenue share, publisher payouts) — discarded from near-term roadmap; browse/import UX kept.
- EDR-lite endpoint agent — discarded / indefinite park, not part of the new thesis at all.
- White-label / MSSP multi-org dashboard as an active roadmap item — already flagged in the prior launch audit as a distraction from the core loop; built code stays, no further investment.

## Historical: the old Phase 3b–9 timeline (retained for provenance, not actionable)

| Phase | Scope | Status |
|---|---|---|
| 3b–3c | Billing, Marketplace | Built — billing unaffected by pivot, marketplace commerce discarded |
| 4 | Cloud connectors + automation | Built partially — re-scoped in Phase E as evidence collectors, not a separate track |
| 5 | Pentest & vulnerability scanning | Built — being replaced by Finding model + Agent Runtime (Phase B–C) |
| 6 | Advanced frameworks + cross-walking | Built — kept, unaffected |
| 7 | AI Advisor (RAG chat) | Built — rewired in Phase E |
| 8 | Enterprise & white-label (SSO/SCIM/RBAC/MSSP) | Built — SSO/SCIM/RBAC kept and extended in Phase F; white-label/MSSP dashboard parked |
| 9 (Bonus) | Endpoint EDR-lite, advanced reporting, regulatory monitoring, API | EDR-lite discarded; reporting kept; regulatory monitoring parked to Phase G; API kept as CLI auth surface |

Related: [[Feature_Backlog]], [[Development_Status]], [[Dharma_Master_Context]].
