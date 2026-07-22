---
title: Audit Process
folder: 02_GRC_KNOWLEDGE
tags: [dharma, grc, audit]
source_docs: [1_PRD.md, 2_TRD.md, 3_APP_FLOW.md]
last_updated: 2026-07-23
status: reviewed
---

# Audit Process

A compliance audit verifies that an org's controls are both designed correctly and (for Type II-style standards) operating effectively, backed by evidence, over an audit period.

## In Dharma, two distinct meanings of "audit"

1. **The compliance audit itself** (external, e.g. ISO 27001 Stage 2 or SOC 2 Type II) — supported via:
   - Evidence lifecycle (`pending` → `verified` → `rejected`/`expired`)
   - Time-limited **Auditor Portal** (`AuditorAccess`): a JWT-scoped, read-only view of frameworks/controls/evidence/audit trail, with a countdown banner showing remaining access time. See [[User_Journeys]] Journey 5, [[Authentication]].
   - One-click signed PDF audit report export (`AuditExport`, `Report`/`ReportSchedule`).

2. **The internal audit trail (`AuditLog`)** — an immutable, cryptographically hash-chained record of every mutation (evidence upload, policy publish, control status change). This is Dharma's answer to Problem Statement item 5 (tamper-evident logs). Verification (`audit.verifyIntegrity`) recomputes the SHA-256 chain from genesis and reports the exact broken entry if tampering occurred. See [[Threat_Model]] and [[Security_Architecture]].

## Flow (Workflow 4 in App Flow doc)

User clicks "Verify Log Integrity" → `audit.verifyIntegrity` query → backend recomputes hash chain → returns `{ isValid, brokenLogId, calculatedCount }` → UI shows green ShieldCheck or red ShieldAlert banner.

Related: [[Security_Architecture]], [[Database_Design]] (`AuditLog`, `ChainAnchor`), [[User_Journeys]].
