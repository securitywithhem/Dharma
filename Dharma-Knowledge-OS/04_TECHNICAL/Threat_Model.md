---
title: Threat Model
folder: 04_TECHNICAL
tags: [dharma, technical, security, threat-model, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, 2_TRD.md, packages/db/schema.prisma]
last_updated: 2026-08-08
status: draft
---

# Threat Model

Still a starting inventory, not a completed STRIDE pass — that gap is now more urgent given the pivot deliberately runs untrusted, possibly hostile application code as its core function. A dedicated STRIDE pass on the Agent Runtime + Sandbox Manager should happen in Phase B, before Phase C's first live agent runs.

## Threats explicitly designed against (pre-pivot, still valid)

1. **Rogue/compromised DB admin altering compliance history** → hash-chained `AuditLog` + external `ChainAnchor`. See [[Security_Architecture]].
2. **Cloud AI vendor data leakage** → local-only Ollama inference by default; the pivot's `LLMProvider` abstraction makes any external provider an explicit, BYOK-gated opt-in, not a silent fallback. See [[System_Architecture]].
3. **MSSP admin over-broad cross-tenant access** → `MsspGrant` explicit allow-list + revocation, rather than a role-based bypass. See [[Authorization]].
4. **Credential/secret exposure at rest** → SHA-256 hash-only for validate-only tokens, AES-256-GCM envelopes for recoverable secrets.
5. **Direct file upload abuse** → presigned URLs (15-min expiry) bypass the app server entirely for uploads.

## New threats introduced by the pivot (must be designed against before Phase C)

6. **Hostile target application content escalating agent privilege (prompt injection)** → four-tier trust boundary (system / tool policy / user / scanned content); tier 4 never escalates. See [[Security_Architecture]] non-negotiable #2. This is the pivot's single biggest new attack surface — Dharma's own Recon/Code/Exploit agents are, by design, ingesting content from applications the platform does not control.
7. **Agent escaping the sandbox to reach the host or other tenants' scan environments** → Sandbox Manager hard limits (no Docker socket, no host filesystem, no host cloud creds, default-deny egress, teardown on completion). Needs a documented isolation test plan before Phase B ships — "validate against one known-safe test app first" in the roadmap is that test, formalize its pass/fail criteria.
8. **Agent-driven SSRF via `http_request` or `run_scan_tool`** reaching internal infrastructure, cloud metadata endpoints, or other tenants' sandboxed containers → same blocklist + DNS-rebind re-check as the pentest module, generalized to every URL-accepting tool. See [[Security_Architecture]] non-negotiable #3.
9. **Agent testing a target the org does not own** (legal exposure, unauthorized access) → ownership verification gate (`VerifiedAsset`) required before any live-target tool call, no exceptions for "the Recon Agent found it, not the user." See [[Security_Architecture]] non-negotiable #4.
10. **False-positive Findings eroding trust ("another noisy scanner")** → not a security threat in the classic sense but the architecture's own stated #1 failure mode. Mitigated by the Validator Agent (independent disproof attempt) and the benchmark/false-positive harness gate before expanding vulnerability classes. See [[Roadmap]] Phase C gate.
11. **Agent auto-applying a code change or opening a PR without review** → hard requirement that suggested patches require human approval; no auto-PR capability exists until an explicit later phase, opt-in. See [[Security_Architecture]] non-negotiable #6.
12. **Cross-tenant leak via shared agent memory or knowledge-graph retrieval** → every `AgentRun`, embedding, and Knowledge Engine query filtered by `organizationId` with the same discipline as every other model. See [[Security_Architecture]] non-negotiable #7 — flagged as the easiest place for a subtle regression once Phase E RAG work starts.

## Not covered in source docs (pre-pivot gaps, still open)

- No documented threat model for the Endpoint agent (EDR-lite) — moot, that surface is now discarded/parked, deprioritize documenting it.
- No documented threat model for the Marketplace — still open, but the commerce layer this would matter most for is discarded from the near-term roadmap; low priority.
- No documented rate-limit thresholds for the pre-pivot limiter, and no thresholds yet defined for Agent Runtime tool calls (see [[Security_Architecture]] rate-limiting note) — needed before Phase B.
- No incident response runbook referenced from this vault.

Related: [[Security_Architecture]], [[Authorization]], [[Risk_Management]], [[System_Architecture]], [[Database_Design]]. Needs a dedicated STRIDE pass on the Agent Runtime/Sandbox Manager specifically, in Phase B.
