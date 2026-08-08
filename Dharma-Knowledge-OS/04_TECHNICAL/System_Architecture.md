---
title: System Architecture
folder: 04_TECHNICAL
tags: [dharma, technical, architecture, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, 2_TRD.md, README.md]
last_updated: 2026-08-08
status: reviewed
---

# System Architecture

## Target architecture (pivot end state)

```
                                   DHARMA
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
          EXPERIENCE               PLATFORM              INTELLIGENCE
        (Web / CLI / CI)      (Security / GRC / Evidence)  (Agents / Knowledge)
              │                       │                       │
   ┌──────────┼──────────┐   ┌────────┼────────┐    ┌─────────┼─────────┐
   Web App   CLI    GH Action  Sandbox Mgr   Risk    Recon  Code  Web/API
                              Security Eng  Engine    Auth  Inject Exploit
                              Compliance    Evidence         Validator
                              Engine        Engine
              │                       │                       │
              └───────────────────────┼───────────────────────┘
                                      │
                          DATA / EVIDENCE / AUDIT LAYER
                    Postgres + pgvector · Redis/BullMQ · MinIO · Audit Log
```

**Core principle carried through every layer**: LLM reasons, deterministic systems decide, humans approve consequential actions. Every agent action is a structured tool call through a policy engine — never free-form shell/API access.

## Stack (pre-pivot foundation, kept)

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Framer Motion |
| API | tRPC v11 |
| State | Zustand |
| Database | PostgreSQL 15+ + pgvector |
| ORM | Prisma 5.x |
| Queue | Redis + BullMQ |
| Object storage | MinIO |
| Auth | NextAuth.js (+ SAML/OIDC) |
| Local AI | Ollama (Llama 3 8B / Mistral) + LangChain.js — now the **default provider** behind the new `LLMProvider` interface, not the only one |
| Deployment | Docker Compose |
| CI | GitHub Actions + Playwright |

This substrate does not change. Everything below is additive.

## Request flow (unchanged)

```
User Browser → Caddy (TLS) → Next.js (tRPC gateway + SSR)
                                ├── Prisma → PostgreSQL + pgvector
                                ├── Presigned URLs → MinIO (evidence files)
                                └── Redis (BullMQ) → Worker process → LLMProvider (Ollama default)
```

## New layer: Sandbox Manager

Runs the **target application itself** (not just a scan tool) in an isolated, ephemeral container so agents have something live to test against.

- Container per scan run: app + declared dependencies (DB, cache) + seeded test data.
- Hard limits: CPU/memory caps, execution timeout, no host Docker socket, no host credential mount, restricted egress.
- Network policy default-deny outbound except to the declared target + build-time dependency sources.
- Teardown on completion or timeout — nothing persists outside captured evidence.

Validate against one known-safe test app before this touches anything real (Phase B).

## New layer: Agent Runtime + Tool System

```
LLM (reasoning) → structured tool_use request → Policy Engine
    → permission check (role, scope, rate limit) → Sandboxed Tool → Result → LLM
```

- Every tool: explicit allowed-permission scope, input schema validation, execution timeout, resource ceiling, mandatory audit-log write.
- Initial tool set: `read_file`, `search_code`, `list_files`, `start_application`, `stop_application`, `http_request`, `inspect_response`, `run_scan_tool`, `query_test_db`, `create_finding`, `collect_evidence`.
- **Treat all repository/application content as untrusted data, never as instructions** — this is the prompt-injection defense line. A README saying "ignore previous instructions" must never reach system-prompt authority.

## New layer: Specialized agents (build one vertical slice first)

Sequence, do not parallelize the build:

1. **Recon Agent** — fingerprint stack, enumerate routes/endpoints/auth boundaries.
2. **Code Agent** — flags *hypotheses* from source only, never auto-declares confirmed.
3. **Web/API Agent** — real requests, session management, response recording.
4. **Exploit Agent** — turns one hypothesis into a reproducible PoC (SQLi + IDOR only in the first slice).
5. **Validator Agent** — independently tries to *disprove* the exploit before it becomes a `Finding`. False-positive firewall — do not skip.

Auth Agent and additional injection-class agents come in the *next* slice, only after this pipeline is proven end-to-end on real test apps.

## New layer: LLM Provider Abstraction

`LLMProvider` interface with OpenAI / Anthropic / local-model (Ollama) implementations, BYOK via env vars. Built once (during the WAVE 1 Ollama connectivity fix, Phase A), reused by the Advisor, Code Agent, Exploit Agent, Validator Agent, and future questionnaire automation. This is the *one* place any of those five consumers should reach for an LLM call — no direct Ollama/OpenAI SDK calls scattered through agent code.

## New layer: Knowledge Engine (Phase E)

Structured DB + vector store + lightweight relationship graph, **with provenance and versioning on every framework/requirement** (`framework_id, version, effective_date, source, last_reviewed`). Heavier than the current pgvector-only setup — non-negotiable if the Advisor is going to stop hallucinating compliance requirements. Replaces the Ollama-only RAG entirely, does not patch it a second time.

## New layer: Risk Engine (Phase F)

New scoring surface: `Asset × Threat × Vulnerability × Likelihood × Impact × Exposure × Business Context`. The current model is CVSS-only, which conflates severity with business risk — these are not the same number and the pre-pivot schema has no place to express the difference. See `Risk` model in [[Database_Design]].

## Performance targets (unchanged, extend to agent tool calls)

- tRPC overhead <10ms
- pgvector search <50ms up to 100k embeddings
- LLM generation ~5–15s (provider-dependent)
- BullMQ pickup delay <500ms
- New: every Agent Runtime tool call carries its own execution timeout and resource ceiling — define per-tool budgets during Phase B, do not inherit the general BullMQ SLA by default.

Related: [[Database_Design]], [[Deployment]], [[Security_Architecture]], [[Threat_Model]].
