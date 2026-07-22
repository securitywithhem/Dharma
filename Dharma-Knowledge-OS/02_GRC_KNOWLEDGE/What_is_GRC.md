---
title: What is GRC
folder: 02_GRC_KNOWLEDGE
tags: [dharma, grc, domain-knowledge]
source_docs: []
last_updated: 2026-07-23
status: reviewed
---

# What is GRC

GRC — Governance, Risk, and Compliance — is the integrated discipline of running an organization so that it meets its objectives (governance), understands and manages the things that could stop it (risk), and satisfies the external rules it's subject to (compliance).

- **Governance**: the structures and decision rights that set policy and hold people accountable — in Dharma, this is `Policy` authorship/publishing and RBAC via `CustomRole`/`Role`. See [[Authorization]].
- **Risk management**: identifying and treating threats to objectives before they materialize. See [[Risk_Management]].
- **Compliance**: demonstrating adherence to a specific framework's control requirements with evidence. See [[Audit_Process]] and the framework notes: [[ISO_27001]], [[SOC_2]], [[GDPR]].

GRC platforms (Dharma's category) exist because these three disciplines share the same underlying data model — controls, evidence, policies, risk register, audit trail — and manually tracking that data model in spreadsheets doesn't scale. Dharma's `Framework` → `Control` → `Evidence` hierarchy (see [[Database_Design]]) is that data model made concrete.

Related: [[Security_Control_Frameworks]], [[User_Journeys]] (Journey 1: Evidence).
