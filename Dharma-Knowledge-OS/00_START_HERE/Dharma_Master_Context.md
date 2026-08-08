---
title: Dharma Master Context
folder: 00_START_HERE
tags: [dharma, overview, context, second-brain, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, README.md, 1_PRD.md, 2_TRD.md, 6_IMPLEMENTATION_PLAN.md, packages/db/schema.prisma]
last_updated: 2026-08-08
status: reviewed
---

# Dharma — Master Context

Read this note first in any new session. It is the single-page synthesis of what Dharma is, where it actually stands, and — as of 2026-08-08 — what it is becoming.

## Governing document

**`Dharma_Pivot_Architecture_Plan.md` is now the top-level authority**, sitting above `PRD.md` / `TRD.md` / `BackendSchema.md` / `Implementationplan.md` and above the older `dharma-master-remediation-prompt.md`. Where any of those disagree with the pivot plan, the pivot plan wins. This note, and every note under `03_PRODUCT/` and `04_TECHNICAL/`, has been rewritten to be consistent with it — do not reintroduce framing from the pre-pivot docs (e.g. "Marketplace commerce," "EDR-lite," "white-label MSSP dashboard" as active roadmap items). Those are explicitly parked or discarded — see [[Roadmap]].

## Identity — before and after

**Before (what shipped through 2026-08-04):** a self-hosted, open-source GRC (governance, risk, compliance) **tracker**. Frameworks and controls exist; evidence is collected manually or via scheduled cloud connectors; a human decides what's true.

**After (the pivot, in progress from 2026-08-08):** a self-hosted **evidence-driven Security & Compliance OS**. The causality inverts:

- Old: `Framework → Control → user manually uploads Evidence → score`
- New: `Application → Agents discover & validate Findings → Evidence auto-generated → Control status updates → Framework score`

This is **not a rewrite**. The existing data model (`Framework`, `Control`, `ControlMapping`, `Evidence`, `AuditLog`) is structurally correct for the target state — see [[Database_Design]]. What's being added is the engine that produces evidence automatically (Security Engine, Agent Runtime, Sandbox Manager) plus the discipline (Risk Engine, Knowledge Engine) to keep its output trustworthy instead of noisy. Still zero-cloud-AI by default: local embeddings/generation via Ollama remain the baseline; the pivot adds an **LLM Provider abstraction** (BYOK, multi-provider) because the new agents need it, not because the local-first principle is being dropped. See [[System_Architecture]].

## Core value proposition (unchanged, extended)

- **Zero-cloud AI by default**, multi-provider by design — Ollama stays the default provider; OpenAI/Anthropic become opt-in via the new `LLMProvider` interface, not a silent fallback. See [[System_Architecture]].
- **Tamper-evident audit log**: SHA-256 hash-chained `AuditLog` rows, verifiable end-to-end, extended with a **dedicated scan/exploit authorization audit trail** for anything agents do against a live target. See [[Security_Architecture]].
- **Self-hosted stack**: Next.js 14 + tRPC v11 + Prisma + PostgreSQL/pgvector + Redis/BullMQ + MinIO + Ollama, all via Docker Compose — now adding a **Sandbox Manager** (ephemeral, isolated per-scan containers) as a new substrate layer. See [[System_Architecture]].

## Actual current stage

The live schema (`packages/db/schema.prisma`) has 49 models and already covers billing, marketplace, cloud connectors, pentest/vulnerability tracking, AI Advisor/RAG, enterprise SSO/RBAC, MSSP, endpoint agent monitoring, and reporting — see [[Feature_Backlog]] for the full built-vs-planned mapping. **Treat this as the pre-pivot baseline, not the target state.** The pivot plan's own component-disposition table (§2) is the authority on what from that baseline survives untouched, gets extended, gets replaced, or gets discarded:

| Verdict | Examples |
|---|---|
| Keep, unchanged | Multi-tenant foundation, RLS pattern, `AuditLog` hash chain (extended, not replaced) |
| Keep — now core, not a side feature | `Framework`/`Control`/`ControlMapping` — becomes the landing surface for auto-generated evidence |
| Keep, extend | `Evidence` model (+`source: "agent"`), Ollama/pgvector RAG (becomes one implementation behind the new `LLMProvider` interface) |
| **Replace** | `Vulnerability`/`PenTest` → unified `Finding` model (see [[Database_Design]]) |
| **Absorb as one tool, not a standalone module** | The pentest module (nuclei + checkbox) becomes a callable `run_external_scan` tool inside the sandboxed Agent Runtime |
| **Discard from near-term roadmap** | Marketplace **commerce** (paid frameworks, revenue share) — keep browse/import UX, drop the storefront |
| **Discard / indefinite park** | EDR-lite endpoint agent (`Endpoint`/`EndpointCheck`), white-label/MSSP multi-org dashboard as a roadmap item (code stays, no further investment) |
| **Park to Phase 8–9 of the new roadmap** | Regulatory change monitoring, questionnaire automation |

See [[Roadmap]] for the full Phase A–G sequencing this table feeds into.

## New components being built (no existing analog)

Sandbox Manager, Agent Runtime + Tool System (policy-engine-gated), five specialized agents built one vertical slice at a time (Recon → Code → Web/API → Exploit → Validator, SQLi + IDOR first), `Finding` model, Risk Engine, Asset & Data Inventory, Knowledge Engine (versioned/provenance-tracked frameworks), LLM Provider Abstraction, Benchmark/False-Positive Harness, CLI + GitHub Action. Full spec for each is in `Dharma_Pivot_Architecture_Plan.md` §3 — read that directly rather than this summary before implementing any of them.

## Non-negotiable security posture for every new component

1. No agent gets unrestricted host access (no Docker socket, no host filesystem, no host cloud credentials).
2. Prompt injection boundary: four trust tiers (system/tool-policy/user/scanned-content); tier 4 never escalates to tier 1/2.
3. SSRF discipline (RFC1918/loopback/link-local/cloud-metadata blocklist + DNS-rebind re-check) applies to every URL-accepting tool, not just pentest.
4. Ownership verification gates any live-target testing, agent-driven or not.
5. Dedicated scan/exploit authorization audit trail, separate from the general `AuditLog`.
6. Human approval required before any code-modifying or externally-visible action.
7. Multi-tenant isolation extends to agent memory and vector retrieval — no agent run, embedding, or knowledge-graph query may cross an `organizationId` boundary.

See [[Security_Architecture]] and [[Threat_Model]] for the full detail behind each line.

## Frameworks supported

DPDP Act 2023, ISO 27001:2022, SOC 2 Type II — see [[ISO_27001]] and [[SOC_2]], cross-walked via `ControlMapping`. The Knowledge Engine (Phase E) adds ASVS and NIST CSF, versioned with provenance, in that priority order.

## Where to go next

- Full pivot spec (read before building anything new) → `Dharma_Pivot_Architecture_Plan.md` (project doc)
- Product vision → [[Vision]], [[Mission]], [[Product_Principles]]
- What's built vs. what's now the target → [[Feature_Backlog]], [[Roadmap]]
- Schema detail incl. new `Finding`/`Asset`/`AgentRun`/`Risk` models → [[Database_Design]]
- Architecture layers (Sandbox Manager, Agent Runtime, LLM Provider) → [[System_Architecture]]
- Security requirements for agent-facing work → [[Security_Architecture]], [[Threat_Model]], [[Authorization]]
- Current build status against the new phase plan → [[Development_Status]]
