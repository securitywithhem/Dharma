---
title: Vision
folder: 00_START_HERE
tags: [dharma, vision, strategy]
source_docs: [1_PRD.md, 2_TRD.md]
last_updated: 2026-07-23
status: reviewed
---

# Vision

Dharma's founding vision, drawn from the PRD elevator pitch and TRD architecture principles:

> A world where compliance certification (DPDP, ISO 27001, SOC 2) doesn't require an organization to hand its most sensitive operational data — network diagrams, employee records, database configs — to a third-party SaaS vendor or a public cloud LLM.

## Strategic pillars

1. **Data sovereignty by default** — every AI capability runs on local infrastructure (Ollama), every file lives in self-hosted MinIO, nothing leaves the deployment boundary. See [[Security_Architecture]].
2. **Radically lower cost of compliance** — undercut Vanta/Drata-style SaaS (PRD cites $10k–$50k/yr) by eliminating per-seat licensing and token billing, targeting India's 1M+ MSME market. See [[Problem_Statement]].
3. **Tamper-evident by construction** — audit trails use cryptographic hash chaining, not just access-controlled database rows, so integrity is provable rather than assumed. See [[Threat_Model]].
4. **Pluggable and extensible** — connectors, marketplace frameworks, and multi-tenant/MSSP support (built out well beyond the original PRD scope — see [[Dharma_Master_Context]]) reflect a platform designed to grow past single-org, single-framework compliance.

## What "done" looks like

The PRD's own success criteria (data sovereignty, <2hr initial assessment, <200ms API, <2s audit verification) remain the north star for product quality even as scope has expanded well past the original MVP. See [[Acceptance_Criteria]].
