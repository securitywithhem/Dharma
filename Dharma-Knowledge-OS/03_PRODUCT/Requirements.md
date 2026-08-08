---
title: Requirements
folder: 03_PRODUCT
tags: [dharma, product, requirements, user-stories, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, 1_PRD.md, AI_CONTEXT.md]
last_updated: 2026-08-08
status: reviewed
---

# Requirements — User Stories

Pre-pivot stories (still valid — the manual-evidence path is not removed, agent-generated evidence is additive) plus the new stories the pivot introduces, organized by role.

**Founder/Admin**
- As a founder, I can upload an MFA screenshot so that the AI suggests a matching control, which I accept, updating the audit log. (Journey 1–2 in [[User_Journeys]])
- As an admin, I can connect an application (repo + running instance) so Dharma's agents can discover and validate findings against it inside an isolated sandbox, without me manually gathering evidence. (Journey 6, new)
- As an admin, I can see exactly which target an agent was authorized to test, when, and by whom, in a dedicated scan/exploit authorization log separate from the general audit trail. (§5 item 5 of the pivot plan)
- As an admin, I can generate a time-limited auditor access link so external auditors can review evidence without write access. (Journey 5)
- As an admin, I can verify the audit log's cryptographic integrity on demand. (Journey 4)

**Compliance Manager**
- As a compliance manager, I can generate an AI policy draft via RAG over DPDP Act text, edit it in a rich editor, and publish it. (Journey 3)
- As a compliance manager, I can track framework progress via a dashboard heatmap of gaps by domain, now populated in part by agent-confirmed findings rather than only manual uploads.
- As a compliance manager, when a `Finding` is confirmed by the Validator Agent, I see the resulting `Evidence` and the `Control` status change together, with the reproduction steps attached — not just a severity number. (§4.1 `Finding` model)

**Security reviewer (new role surface, not a new `Role` enum value — reuses `CustomRole` permission scopes)**
- As a security reviewer, I can review a Recon/Code Agent's *hypothesis* before it becomes a reproducible exploit attempt — the Code Agent never auto-declares a finding confirmed. (§3.3)
- As a security reviewer, I can require human approval before any suggested patch is applied — agents never auto-apply code changes or open PRs in this phase. (§5 item 6)

**Auditor (external)**
- As an auditor, I can access a read-only portal via a time-limited token to review frameworks, evidence, and the audit trail, with a visible countdown to link expiry. This now includes agent-generated evidence with its source (`AGENT_EXPLOIT`) clearly labeled, never conflated with manually-uploaded evidence.

**Viewer**
- As a viewer, I have read-only access to organization compliance data, enforced by `Role`/`CustomRole` at the tRPC context layer. See [[Authorization]]. This extends to agent-run visibility: a viewer can see that a scan ran and its outcome, not raw tool-call payloads.

See [[Acceptance_Criteria]] for the measurable bar each of these is held to, and [[Database_Design]] for the underlying models (`Finding`, `Asset`, `AgentRun`, `Risk`).
