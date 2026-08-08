---
title: Feature Backlog
folder: 03_PRODUCT
tags: [dharma, product, backlog, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, packages/db/schema.prisma]
last_updated: 2026-08-08
status: reviewed
---

# Feature Backlog

This backlog is organized around the pivot's Phase A–G, not the old Phase 3b–9 numbering — see [[Roadmap]] for the sequencing rationale and [[Dharma_Master_Context]] for the survives/extends/replaced/discarded disposition of everything already built.

## Already built — pre-pivot baseline (kept, status per pivot disposition)

- [x] Framework/Control management (DPDP, ISO 27001, SOC 2) — **kept, now core**: becomes the landing surface for auto-generated evidence
- [x] Local AI policy generation (RAG over regulation text) — **kept, plumbing replaced**: moves onto the new `LLMProvider` abstraction, Ollama stays the default
- [x] Evidence & artifact management (MinIO) — **kept, extended**: add `source: "agent"` alongside `"manual"`/`"auto-connector"`
- [x] AI-powered evidence-to-control mapping (pgvector) — kept
- [x] Compliance dashboard & gap heatmap — kept
- [x] Cryptographic verifiable audit trail (SHA-256 chain) — **kept, extended**: add dedicated scan/exploit authorization audit trail (§5 item 5 of the pivot plan)
- [x] Time-limited auditor portal — kept
- [x] Org & user management, RBAC — **kept, extended**: `CustomRole` gains agent tool permission scopes, see [[Authorization]]
- [x] Multi-tenant billing/subscriptions — kept, unaffected by pivot
- [x] Marketplace: publish/discover/import frameworks — **kept (browse/import UX only)**; commerce layer (paid frameworks, revenue share, publisher payouts) **discarded from near-term roadmap**
- [~] Cloud connectors + auto evidence mapping — **re-scoped**: becomes one evidence source among several feeding the same `Evidence` model, not a separate track. AWS/GitHub/Okta/Jira adapters stay; Azure/GCP gap not prioritized until Phase E
- [x] Pentest/vulnerability tracking (`PenTest`, `Vulnerability`, `Asset`) — **replace with `Finding`** (§4 of pivot plan); do not extend `Vulnerability` further, do not build ZAP/Burp import (Agent Runtime's `run_external_scan` tool supersedes it)
- [x] Advanced frameworks + cross-walking (`ControlMapping`) — kept, unaffected
- [x] AI Advisor (RAG chat) — **kept, rewired**: sits on Knowledge Engine + LLM Provider abstraction in Phase E instead of raw pgvector-only RAG
- [x] Enterprise SSO/SCIM + custom RBAC — kept, unaffected; touched again in Phase F alongside agent tool permissions
- [x] White-label + MSSP multi-org dashboard — **built, discarded/parked as a roadmap item**: no further investment, code stays as-is
- [x] Endpoint agent monitoring / EDR-lite — **discarded / indefinite park**: not part of the pivot thesis, orthogonal
- [x] Advanced/scheduled reporting — kept, unaffected; Phase D extends templates with Finding evidence sections
- [x] Regulatory change monitoring + framework versioning — **parked to Phase G**, correctly sequenced after the Security/Compliance Engines are trustworthy
- [x] Full third-party API (`ApiKey`) — kept, becomes the auth surface for the new CLI (Phase D)

## New — the pivot's actual engineering lift (Phase B–G, build in this order)

### Phase B
- [ ] Sandbox Manager — container-per-scan-run isolation, hard resource limits, default-deny egress, teardown on completion/timeout. Validate against one known-safe test app before touching anything real.
- [ ] Agent Runtime + Tool System — LLM reasoning → structured tool_use → Policy Engine → sandboxed tool → result, with mandatory audit-log write per call
- [ ] `Finding` model — additive Prisma migration + backfill script from `Vulnerability`
- [ ] Benchmark / False-Positive Harness skeleton — `tests/vulnerable-apps/sqli`, `/idor` first

### Phase C
- [ ] Recon Agent — fingerprint stack, enumerate routes/endpoints/auth boundaries
- [ ] Code Agent — flags hypotheses only, never auto-confirms
- [ ] Web/API Agent — real requests, session management, response recording
- [ ] Exploit Agent — SQLi + IDOR only in this slice
- [ ] Validator Agent — independently tries to disprove before a `Finding` is created (false-positive firewall — do not skip)
- [ ] Wire confirmed `Finding` → `Evidence` → `Control` status auto-update end to end

### Phase D
- [ ] Auth Agent, Command Injection, Path Traversal agents — each gated by the benchmark harness before moving to the next class
- [ ] CLI (`dharma init/scan/findings/validate/report/compliance/evidence`)
- [ ] GitHub Action with PR-comment integration, `severity_threshold`/`fail_on_confirmed` policy
- [ ] Suggested-patch generation on confirmed findings (not auto-PR)

### Phase E
- [ ] Asset & Data Inventory — `Asset` (reconciled with the existing pentest-scoped model — see [[Database_Design]]), `DataStore`, `PersonalDataCategory`
- [ ] Knowledge Engine — versioned/provenance-tracked frameworks, priority order ASVS → NIST CSF → SOC2 → ISO27001 → DPDP
- [ ] Rewire Compliance Advisor onto Knowledge Engine + `LLMProvider`
- [ ] Readiness scoring — enforce "readiness ≠ certification" language everywhere in copy

### Phase F
- [ ] `Risk` model, risk register UI, exceptions with mandatory expiry
- [ ] Reconcile Roles-page/Team-membership drift while RBAC is touched for agent tool permissions

### Phase G
- [ ] Trust Center, security questionnaire automation, regulatory change monitoring — only after A–F are solid

See [[Roadmap]] for the phase-to-timeline mapping and [[User_Journeys]] for the flagship journey this backlog produces.
