---
title: GDPR
folder: 02_GRC_KNOWLEDGE
tags: [dharma, grc, gdpr, dpdp, framework]
source_docs: [1_PRD.md]
last_updated: 2026-07-23
status: reviewed
---

# GDPR (and its Indian analogue, the DPDP Act 2023)

GDPR (EU General Data Protection Regulation) is the reference model for modern data-protection law: lawful basis for processing, data subject rights (access, erasure, portability), breach notification within 72 hours, and penalties up to 4% of global revenue.

Dharma's actual primary regulatory target is not GDPR but its Indian counterpart, the **Digital Personal Data Protection (DPDP) Act 2023** — structurally similar (consent-based processing, data principal rights, data fiduciary duties) but India-specific, with penalties up to ₹250 Crores per PRD Section 2. It's documented here alongside GDPR because they share a knowledge lineage and Dharma's RAG policy generator draws on parsed DPDP Act text the same way a GDPR-focused tool would draw on GDPR text.

## In Dharma

- DPDP Act sections are chunked (~500 chars, 100-char overlap) and embedded into `RegulationSnippet` rows for RAG retrieval. See [[System_Architecture]] (RAG pipeline).
- Policy generation (`policy.triggerAIGeneration`) retrieves relevant DPDP snippets via pgvector, injects them into the local Llama 3 prompt, and drafts a policy (e.g. Access Control Policy) for review in TipTap. See [[User_Journeys]] Journey 3.
- No GDPR-specific `Framework` seed data is confirmed in the source docs — only DPDP, ISO 27001, and SOC 2 are named as seeded frameworks (PRD Section 4, Feature 1).

Related: [[Audit_Process]], [[Database_Design]] (`RegulationSnippet`), [[Security_Architecture]].
