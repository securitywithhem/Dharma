# 1. PRD — Product Requirements Document

## Dharma — Self-Hosted Compliance Platform

---

## Executive Summary

**Dharma** is a self-hosted, open-source compliance management system designed specifically for Indian MSMEs and startups to automate evidence collection, policy management, and compliance tracking for frameworks like the **Digital Personal Data Protection (DPDP) Act 2023**, **ISO 27001:2022**, and **SOC 2 Type II**. By running entirely on local infrastructure with local AI models, Dharma guarantees data sovereignty while dramatically reducing the cost of compliance.

---

## 1. Product Overview

### Product Name
**Dharma**

### Tagline
*"Self-hosted compliance made simple. Automate DPDP, ISO 27001, and SOC 2 locally with AI."*

### Product Elevator Pitch
Organizations struggle to manage compliance frameworks under tight budgets. They lack centralized evidence repositories, spend hours writing policies, and have no easy way to verify compliance status. Dharma solves this by providing a self-hosted alternative to expensive SaaS compliance platforms like Vanta and Drata. By running entirely on the organization's own servers, leveraging local AI models (via Ollama) and local vector search, Dharma keeps sensitive configuration data and PII completely private while automating tedious audit readiness workflows.

---

## 2. Problem Statement

### The Problem
- **Indian DPDP Act 2023 Penalties:** The DPDP Act imposes penalties of up to ₹250 Crores for data breaches, requiring Indian companies to quickly establish robust consent frameworks and data processing records.
- **Data Sovereignty & Privacy Concerns:** Traditional SaaS compliance tools require uploading sensitive information (API logs, database configuration files, employee records, internal security settings) to external cloud servers, which violates data privacy policies and local host guidelines.
- **Manual Evidence Collection:** Teams waste hundreds of hours manually collecting screenshots, PDF reports, and log files from different parts of their infrastructure.
- **High Cost Barriers:** Commercial SaaS platforms cost between $10k to $50k+ annually, which is prohibitively expensive for Indian MSMEs and early-stage startups.
- **Lack of Tamper Proofing:** Standard database-logged audit trails can be altered by database administrators, making them unreliable during formal audits.

### Market Opportunity
- 1M+ registered MSMEs and startups in India need to comply with the DPDP Act 2023 and satisfy international clients with ISO 27001 or SOC 2 certifications.
- Open-source, self-hosted compliance platforms with data sovereignty are highly sought after by security-conscious CTOs.
- Demand for a zero-marginal-cost compliance system that uses local LLMs to eliminate expensive token billing.

---

## 3. Target Users

### Primary Users
1. **Founders & CTOs of Indian Startups**
   - Need to achieve SOC 2 or ISO 27001 quickly to close enterprise customers.
   - Responsible for overall company risk, but lack dedicated security staff.
   - Want a cost-effective, easily deployable solution.

2. **Security & Compliance Officers**
   - Track control statuses across different frameworks.
   - Draft and review organizational policies.
   - Maintain readiness for annual external audits.

3. **External Auditors & Evaluators**
   - Need read-only access to verify compliance evidence and policy versions.
   - Require proof of audit log integrity (tamper-proofing).

---

## 4. Core Features

### Feature 1: Compliance Framework Management
- **What:** Manage tracking of DPDP Act 2023, ISO 27001, and SOC 2 frameworks.
- **Why:** Teams need structured visibility into control requirements and their current progress.
- **How:**
  - Seed framework requirements as a structured JSON catalog (loaded via database migrations).
  - Track framework progress indicators (% complete, control count).
  - Map specific controls to evidence files and policies.

### Feature 2: Local AI-Powered Policy Generation (RAG)
- **What:** Generate professional security policy drafts matching framework requirements using a local LLM.
- **Why:** Writing security policies from scratch takes 20+ hours of manual drafting.
- **How:**
  - RAG (Retrieval-Augmented Generation) retrieves relevant clauses of regulations (e.g., DPDP Act sections) stored in a local vector database.
  - Generates markdown policy drafts using a local Ollama instance (Llama 3 8B or Mistral) based on user-provided organizational context.
  - Interactive TipTap editor to review, edit, and version the draft before publishing.

### Feature 3: Evidence & Artifact Management
- **What:** Centralized, secure storage for all compliance evidence.
- **Why:** Compliance documents are highly sensitive and currently scattered across Google Drive, email, and local drives.
- **How:**
  - Self-hosted object storage using **MinIO** with presigned URLs for secure file uploads/retrievals.
  - Support for screenshot uploads, PDF reports, database configuration dumps, and logs.
  - Evidence status tracking lifecycle (`pending` → `verified` → `rejected`/`expired`).

### Feature 4: Local AI-Powered Evidence Mapping & Analysis
- **What:** Automatic classification and mapping of uploaded evidence to compliance requirements.
- **Why:** Matching dozens of files to complex framework controls is tedious.
- **How:**
  - Extract text/metadata from uploaded documents.
  - Generate embeddings using Ollama and perform cosine similarity searches in PostgreSQL using **pgvector**.
  - Suggest the top 3 requirements that the evidence satisfies. User reviews and clicks to accept or reject the mapping.

### Feature 5: Real-time Compliance Dashboard & Heatmap
- **What:** Visual summary of the organization’s overall compliance posture.
- **Why:** Leadership needs an instantaneous overview of gaps and audit readiness.
- **How:**
  - Overall readiness score (0-100%) and framework-specific progress bars.
  - Gap heatmap indicating domains (e.g., Access Control, Risk Assessment) that lack evidence or active policies.
  - Recent audit activity log feed.

### Feature 6: Cryptographic Verifiable Audit Trail
- **What:** A tamper-evident log recording all actions altering the compliance state (policy edits, evidence uploads, verification).
- **Why:** To satisfy auditors that compliance logs have not been retroactively altered.
- **How:**
  - Audit log entries are chained together using **SHA-256 hash chaining** (similar to a blockchain).
  - Each entry stores `previousHash`. Changing any past row breaks the chain.
  - A "Verify Log Integrity" button recomputes the hash chain to mathematically prove that the audit log is intact.

### Feature 7: Time-Limited Auditor Portal
- **What:** Secure, read-only dashboard view for external auditors.
- **Why:** Auditors need a clear view of evidence without access to modification actions.
- **How:**
  - Generate a secure, time-limited token (JWT) with a customizable expiry date.
  - Auditor accesses a clean, read-only interface listing frameworks, mapped controls, verified evidence files, and the cryptographic audit trail.
  - A persistent countdown banner indicates session expiry.

### Feature 8: Organization & User Management
- **What:** Google OAuth and email magic link login with basic Role-Based Access Control (RBAC).
- **Why:** Secures sensitive compliance data while allowing team collaboration.
- **How:**
  - Secure authentication via **NextAuth.js**.
  - Roles: `ADMIN` (full control), `COMPLIANCE_MANAGER` (can edit controls/policies/evidence), and `VIEWER` (read-only).
  - Enforces organization-level isolation on all queries.

---

## 5. Success Metrics

### Operational Metrics
- **Zero Cloud Leaks:** 100% of LLM processing and file storage is handled locally (Ollama, MinIO, Postgres), leaking zero sensitive company data.
- **Fast Assessment:** Complete initial DPDP Act self-assessment and policy drafting in under 2 hours.
- **High API Performance:** Core page load API response times < 200ms (achieved via Next.js SSR and tRPC v11).
- **Verifiable Logs:** Verification of the cryptographic audit trail completes in < 2 seconds.

---

## 6. Out of Scope (Phase 1)
- Multi-organization tenant SaaS configurations (platform runs as a single organization deployment per Docker-compose instance).
- Automated cloud integration connectors (e.g., direct API connections to AWS CloudTrail or GitHub, which will be built in Phase 2).
- Advanced automated penetration scanning.

---

## 7. Success Criteria

**MVP Launch Readiness:**
- ✅ Predefined DPDP Act 2023, ISO 27001, and SOC 2 requirements seeded.
- ✅ NextAuth.js authentication with Google and magic links working.
- ✅ Local MinIO container successfully saving and serving files securely.
- ✅ Local Ollama instance successfully generating policies and analyzing evidence text.
- ✅ pgvector correctly ranking control mapping suggestions.
- ✅ Cryptographic audit log hash chain functioning with verification logic.
- ✅ Docker Compose configuration launching all services (`nextjs`, `postgres`, `redis`, `minio`, `ollama`) with a single command.

---

## Document Version

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-01-20 | Team | Initial PRD |
| 2.0 | 2026-06-20 | Antigravity | Updated for Dharma (Indian MSMEs, DPDP Act, Local AI, Cryptographic Audit Logs, tRPC) |
