---
title: Threat Model
folder: 04_TECHNICAL
tags: [dharma, technical, security, threat-model]
source_docs: [2_TRD.md, packages/db/schema.prisma]
last_updated: 2026-07-23
status: draft
---

# Threat Model

No dedicated STRIDE (or equivalent) threat-modeling document exists in the source docs. This note synthesizes the security-relevant decisions scattered across the TRD and schema comments — it is a starting inventory, not a completed threat model.

## Threats explicitly designed against

1. **Rogue/compromised DB admin altering compliance history** → hash-chained `AuditLog` + external `ChainAnchor`. See [[Security_Architecture]].
2. **Cloud AI vendor data leakage** → local-only Ollama inference, `vector(384)` embeddings confirm no OpenAI fallback is silently in use. See [[System_Architecture]].
3. **MSSP admin over-broad cross-tenant access** → `MsspGrant` explicit allow-list + revocation, rather than a role-based bypass. See [[Authorization]].
4. **Credential/secret exposure at rest** → SHA-256 hash-only for validate-only tokens, AES-256-GCM envelopes for recoverable secrets. See [[Security_Architecture]].
5. **Direct file upload abuse** → presigned URLs (15-min expiry) bypass the app server entirely for uploads, limiting blast radius of a compromised API route.

## Not covered in source docs (gaps)

- No documented threat model for the **Endpoint agent** (EDR-lite) trust boundary — a compromised endpoint could submit false `EndpointCheck` results; no attestation/anti-spoofing mechanism is documented.
- No documented threat model for the **Marketplace** — a malicious `MarketplaceItem` publisher could distribute a framework/connector with harmful `config`/`metadata`; review/moderation process undocumented.
- No documented rate-limit thresholds (token bucket exists per TRD, but no numbers).
- No incident response runbook referenced from this vault (root-level `DEPLOYMENT_RUNBOOK.md` may cover this — not yet ingested into this vault).

Related: [[Security_Architecture]], [[Authorization]], [[Risk_Management]]. Needs a dedicated STRIDE pass per the master bootstrap's own note.
