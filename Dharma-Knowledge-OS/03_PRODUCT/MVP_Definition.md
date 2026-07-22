---
title: MVP Definition
folder: 03_PRODUCT
tags: [dharma, product, mvp]
source_docs: [1_PRD.md]
last_updated: 2026-07-23
status: reviewed
---

# MVP Definition

From PRD Section 7 ("Success Criteria — MVP Launch Readiness"):

- [x] Predefined DPDP Act 2023, ISO 27001, and SOC 2 requirements seeded
- [x] NextAuth.js authentication with Google and magic links working
- [x] Local MinIO container successfully saving and serving files securely
- [x] Local Ollama instance successfully generating policies and analyzing evidence text
- [x] pgvector correctly ranking control mapping suggestions
- [x] Cryptographic audit log hash chain functioning with verification logic
- [x] Docker Compose configuration launching all services with a single command

This MVP bar was cleared before the product expanded into the much larger feature set in [[Feature_Backlog]]. PRD Section 6 explicitly scoped **out** of this MVP: multi-tenant SaaS, cloud connectors, and automated pentest scanning — all three are now built (see [[Dharma_Master_Context]]), meaning the product has moved well past this original MVP definition without a documented "MVP v2."

Related: [[Acceptance_Criteria]], [[Roadmap]].
