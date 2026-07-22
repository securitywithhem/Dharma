---
title: Requirements
folder: 03_PRODUCT
tags: [dharma, product, requirements, user-stories]
source_docs: [1_PRD.md, AI_CONTEXT.md]
last_updated: 2026-07-23
status: reviewed
---

# Requirements — User Stories

From the PRD and AI_CONTEXT synthesis, organized by role:

**Founder/Admin**
- As a founder, I can upload an MFA screenshot so that the AI suggests a matching control, which I accept, updating the audit log. (Journey 1–2 in [[User_Journeys]])
- As an admin, I can generate a time-limited auditor access link so external auditors can review evidence without write access. (Journey 5)
- As an admin, I can verify the audit log's cryptographic integrity on demand. (Journey 4)

**Compliance Manager**
- As a compliance manager, I can generate an AI policy draft via RAG over DPDP Act text, edit it in a rich editor, and publish it. (Journey 3)
- As a compliance manager, I can track framework progress via a dashboard heatmap of gaps by domain.

**Auditor (external)**
- As an auditor, I can access a read-only portal via a time-limited token to review frameworks, evidence, and the audit trail, with a visible countdown to link expiry.

**Viewer**
- As a viewer, I have read-only access to organization compliance data, enforced by `Role` at the tRPC context layer. See [[Authorization]].

See [[Acceptance_Criteria]] for the measurable bar each of these is held to, and [[Database_Design]] for the underlying models.
