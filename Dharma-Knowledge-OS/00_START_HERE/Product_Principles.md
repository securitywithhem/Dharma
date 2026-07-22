---
title: Product Principles
folder: 00_START_HERE
tags: [dharma, principles, architecture]
source_docs: [2_TRD.md, 5_BACKEND_SCHEMA.md]
last_updated: 2026-07-23
status: reviewed
---

# Product Principles

Derived from the TRD's architecture principles and reinforced by patterns visible in the live schema.

## 1. Multi-tenant by default (at the data layer)

Every business row links back to an `Organization`; tRPC context filters by `organizationId` at the query layer. This principle held even as the product grew from "single organization per Docker Compose instance" (PRD's stated Phase 1 scope) into an actual multi-tenant SaaS with billing (`Plan`) and MSSP oversight (`MsspGrant`). See [[Database_Design]] and [[Authorization]].

## 2. Pluggable, adapter-pattern connectors

Cloud connectors (`Connector` model) follow a typed adapter interface so new evidence sources can be added without touching core evidence logic. See [[API_Design]].

## 3. Async/event-driven for anything slow

Anything involving AI inference, file parsing, or PDF generation goes through BullMQ/Redis rather than blocking a request — this keeps the TRD's <200ms p95 API target achievable. See [[System_Architecture]].

## 4. Security-first, not security-later

- AES-256 credential encryption for connector secrets
- Append-only, hash-chained audit log (not just access-controlled)
- Rate limiting via token bucket
See [[Security_Architecture]] and [[Threat_Model]].

## 5. Local AI, no exceptions

The embedding dimension in the live schema (`vector(384)`) confirms the local `nomic-embed-text`-class model is still in use, not a swap to OpenAI's 1536-dim embeddings — this principle has held in practice, not just on paper. See [[Dharma_Master_Context]].
